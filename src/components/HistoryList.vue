<template>
    <div
        class="history-container"
        :style="colors"
        :class="{ 'windows-scrollbar-hidden': isWindowsPlatform }"
    >
        <div
            class="h-item"
            v-for="item in items"
            @click="emit('enterRoom', item.room_id)"
        >
            <div class="cover">
                <BiliImg :src="item.cover" :use-disk="true" />
                <div
                    class="status"
                    :class="{ 'is-live': item.live_status === 1 }"
                >
                    {{ item.live_status === 1 ? "直播中" : "未开播" }}
                </div>
            </div>
            <div class="info">
                <div class="title">{{ item.title }}</div>
                <div class="time">{{ formatTime(item.view_at) }}</div>
                <div class="up">{{ item.author_name }}</div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { HistoryItem } from "../detail/HistoryList";
import BiliImg from "./BiliImg.vue";
import { formatTime } from "../utility/format_time.ts";
import { computed } from "vue";
import { platform } from "../detail/WindowControl";
const props = withDefaults(
    defineProps<{
        items: HistoryItem[];
        accentColor?: string;
        hlColor?: string;
        bgColor?: string;
    }>(),
    {
        accentColor: "pink",
        hlColor: "white",
        bgColor: "transparent",
    },
);

const isWindowsPlatform = computed(() => platform.value === "windows");

const colors = computed(() => ({
    "--hl-color": `${props.hlColor}`,
    "--accent-color": `${props.accentColor}`,
    "--bg-color": `${props.bgColor}`,
}));

const emit = defineEmits<{
    (e: "enterRoom", id: number): void;
}>();
</script>

<style scoped>
.status.is-live {
    background-color: color-mix(in srgb, var(--accent-color) 80%, transparent);
}
.status {
    position: absolute;
    top: 4px;
    right: 6px;
    color: white;
    font-size: 0.8em;
    font-weight: bold;
    background-color: rgba(128, 128, 128, 0.8);
    backdrop-filter: blur(1px);
    border-radius: 8px;
    padding: 2px;
}
.time {
    margin-top: auto;
}
.time,
.up {
    color: grey;
    font-size: 0.8em;
}
.title {
    color: var(--hl-color);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-all;
}
.cover {
    height: 4.5em;
    aspect-ratio: 16/9;
    border-radius: 10px 0 0 10px;
    overflow: hidden;
    flex-shrink: 0;
    position: relative;
}
.info {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    flex-grow: 1;
    padding: 0 0.5em;
    min-width: 0;
}
.h-item {
    display: flex;
    padding: 0.5em;
    box-sizing: border-box;
    cursor: pointer;
}
.h-item:hover {
    background-color: color-mix(in srgb, var(--accent-color) 20%, transparent);
}
.history-container {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow-y: auto;
    overflow-x: hidden;
}
.windows-scrollbar-hidden {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
.windows-scrollbar-hidden::-webkit-scrollbar {
    width: 6px;
}
.windows-scrollbar-hidden::-webkit-scrollbar-track {
    background: transparent;
}
.windows-scrollbar-hidden::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.35);
    border-radius: 999px;
}
</style>
