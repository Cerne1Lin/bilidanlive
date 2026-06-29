<template>
    <div class="content" v-loading="isConnecting" :style="cssVars">
        <div class="connect-tip" v-show="!isConnected">未连接弹幕服务器</div>
        <SuperChat
            class="super-chat"
            :items="scItems"
            v-show="scItems.length > 0"
        />
        <div
            ref="panelRef"
            class="chat-history-panel"
            :class="{ 'hide-scrollbar': hideScrollbar }"
            @scroll="onPanelScroll"
        >
            <TransitionGroup name="chat">
                <ChatItem
                    v-for="item in danmuItems"
                    :key="item.id"
                    :text="item.text"
                    :user="item.user"
                    :emoticon="item.emoticon ? item.emoticon.url : null"
                    :medal="item.medal"
                    :type="item.type"
                    :sc="item.sc"
                    :hl-color="hlColor"
                    :accent-color="accentColor"
                    :font-size="settings.fontSize.value"
                    :bg-color="itemBgColor"
                />
            </TransitionGroup>
        </div>
        <div
            class="scroll-to-bottom-btn"
            v-show="showDownBtn && danmuItems.length > 0"
            @click="onScrollToBottomClick"
        >
            <SvgIcon class="btn-icon" :svg-raw="svg.downSvg" :size="'1.5em'" />
        </div>
        <div
            class="pending-size"
            v-show="pendingSize > 0"
            @click="onScrollToBottomClick"
        >
            {{ (pendingSize > 99 ? "99+" : pendingSize) + "新消息" }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    ref,
    watch,
    nextTick,
    onActivated,
    onDeactivated,
    onMounted,
    onUnmounted,
} from "vue";
import ChatItem from "./ChatItem.vue";
import SuperChat from "./SuperChat.vue";
import type { DanmuItem } from "../detail/DanData.ts";
import { pauseDanmu, resumeDanmu, historyTick } from "../detail/DanData.ts";
import type { ScItem } from "../detail/SuperChat.ts";
import { svg } from "../detail/Assets";
import SvgIcon from "./SvgIcon.vue";
import settings from "../detail/Setting.ts";
import { radius } from "../detail/Theme.ts";

const props = withDefaults(
    defineProps<{
        danmuItems: DanmuItem[];
        scItems: ScItem[];
        pendingSize: number;
        isConnected: boolean;
        isConnecting: boolean;
        hlColor?: string;
        accentColor?: string;
        itemBgColor?: string;
        bgColor?: string;
    }>(),
    {
        hlColor: "white",
        accentColor: "pink",
        bgColor: "transparent",
        itemBgColor: "transparent",
    },
);

const cssVars = computed(() => ({
    "--hl-color": `${props.hlColor}`,
    "--accent-color": `${props.accentColor}`,
    "--bg-color": `${props.bgColor}`,
    "--radius": radius.value,
}));
// ── 滚动控制 ──────────────────────────────────────

const panelRef = ref<HTMLElement | null>(null);
const BOTTOM_THRESHOLD = 24;
const PAUSE_THRESHOLD = 100; // 距底超过 50px → 暂停主队列
const hideScrollbar = ref(true);
const showDownBtn = ref(false);
/** 进入房间后的初始加载阶段：无视 scroll 位置强制滚底 */
const isInitialLoad = ref(false);
let initialLoadTimer: ReturnType<typeof setTimeout> | null = null;
/** 记录上次距底距离，用于 ResizeObserver 判断缩小前是否在底部 */
let lastDistFromBottom = 0;

function endInitialLoad() {
    isInitialLoad.value = false;
    if (initialLoadTimer) {
        clearTimeout(initialLoadTimer);
        initialLoadTimer = null;
    }
}

/** 强制滚底（浏览器自动 clamp 到最大 scrollTop） */
function forceScrollToBottom() {
    const panel = panelRef.value;
    if (!panel) return;
    panel.scrollTop = panel.scrollHeight;
}

function distFromBottom(el: HTMLElement): number {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function onScrollToBottomClick() {
    endInitialLoad();
    resumeDanmu();
    showDownBtn.value = false;
    nextTick(() => {
        forceScrollToBottom();
        requestAnimationFrame(() => forceScrollToBottom());
    });
}

function checkScrollPosition() {
    const panel = panelRef.value;
    if (!panel) return;
    const dist = distFromBottom(panel);
    hideScrollbar.value = dist <= BOTTOM_THRESHOLD;
    lastDistFromBottom = dist;

    if (dist > PAUSE_THRESHOLD) {
        showDownBtn.value = true;
        pauseDanmu();
        endInitialLoad();
    } else {
        showDownBtn.value = false;
        resumeDanmu();
    }
}

function onPanelScroll() {
    checkScrollPosition();
}

// ── 监听滚动区域尺寸变化 ──────────────────────────

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
    resizeObserver = new ResizeObserver(() => {
        // 缩小前已在底部且弹幕未暂停 → 保持底部跟随，避免误触发 pause
        if (lastDistFromBottom <= BOTTOM_THRESHOLD) {
            forceScrollToBottom();
            hideScrollbar.value = true;
            showDownBtn.value = false;
            lastDistFromBottom = 0;
            return;
        }
        checkScrollPosition();
    });
    if (panelRef.value) {
        resizeObserver.observe(panelRef.value);
    }
});

onUnmounted(() => {
    resizeObserver?.disconnect();
});

// ── KeepAlive：保存/恢复滚动位置 ───────────────────

onDeactivated(() => {
    endInitialLoad();
});

onActivated(() => {
    nextTick(() => {
        forceScrollToBottom();
        requestAnimationFrame(() => forceScrollToBottom());
    });
});

// ── 弹幕更新 → 自动滚底 ──────────────────────────

watch(
    () => props.danmuItems,
    () => {
        const panel = panelRef.value;
        if (!panel) return;
        // 初始加载阶段：强制滚底；正常阶段：仅在已在底部时跟随
        if (isInitialLoad.value || distFromBottom(panel) <= BOTTOM_THRESHOLD) {
            nextTick(() => {
                forceScrollToBottom();
                requestAnimationFrame(() => forceScrollToBottom());
            });
        }
    },
);

// 历史弹幕加载完成 → 进入初始加载模式，延迟解锁
watch(historyTick, () => {
    isInitialLoad.value = true;
    if (initialLoadTimer) clearTimeout(initialLoadTimer);
    // 立即滚底 + 延迟补偿（等图片加载 / 实时弹幕涌入）
    nextTick(() => {
        forceScrollToBottom();
        requestAnimationFrame(() => forceScrollToBottom());
    });
    initialLoadTimer = setTimeout(() => {
        forceScrollToBottom();
        isInitialLoad.value = false;
        initialLoadTimer = null;
    }, 2000);
});
</script>

<style scoped>
.pending-size {
    position: absolute;
    right: 50%;
    bottom: 2px;
    transform: translate(50%);
    color: var(--hl-color);
    background-color: rgba(255, 192, 203, 0.2);
    backdrop-filter: blur(1px);
    border-radius: 99px;
    padding: 0 6px;
    line-height: 1.4;
    font-size: 0.8em;
    font-weight: bold;
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
}
.connect-tip {
    display: flex;
    color: var(--accent-color);
    justify-content: center;
    font-size: 0.8em;
    background-color: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(1px);
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 99;
}
.scroll-to-bottom-btn {
    position: absolute;
    bottom: 1em;
    right: 1em;
    height: 2em;
    aspect-ratio: 1;
    border-radius: 99px;
    background-color: rgba(255, 192, 203, 0.2);
    backdrop-filter: blur(1px);
    display: flex;
    justify-content: center;
    color: var(--hl-color);
    align-items: center;
    padding: 2px;
    box-sizing: border-box;
}
.content {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius);
    border: 2px solid var(--accent-color);
    position: relative;
    background-color: var(--bg-color);
}
.super-chat {
    width: 100%;
    min-height: 2.5em;
    position: absolute;
    top: 0;
    background-color: rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(1px);
    z-index: 99;
}
.chat-history-panel {
    flex-grow: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background-color: transparent;
    overflow-y: auto;
    overflow-x: hidden;
    box-sizing: border-box;
    padding: 0 1em;
    align-items: start;
}
.chat-history-panel.show-scrollbar {
    overflow-y: scroll;
}
.chat-history-panel.hide-scrollbar {
    scrollbar-width: none;
}
.chat-history-panel.hide-scrollbar::-webkit-scrollbar {
    display: none;
}

/* ── ChatItem 入场动画 ──────────────────────── */

.chat-move,
.chat-enter-active {
    transition:
        opacity 0.2s ease-out,
        transform 0.3s ease-out;
}
.chat-enter-from {
    opacity: 0;
    transform: translateX(-30px);
}
.chat-leave-active {
    transition: all 0.2s ease-in;
}
.chat-leave-to {
    opacity: 0;
}
</style>
