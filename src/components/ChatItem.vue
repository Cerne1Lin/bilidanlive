<template>
    <div class="dan-box" :style="colors">
        <div class="danmu" v-if="type !== 'sc'">
            <div class="avater-box">
                <BiliImg class="avater" :src="user.face" bg-color="transparent" :default="img.defaultFace"/>
            </div>
            <div class="right-box">
                <div class="name-box">
                    <div
                        class="name"
                        :style="{ color: getNameColor(medal?.guard_level ?? null), fontWeight: getFontWeight(medal?.guard_level??null)}"
                    >{{ user.name }}</div>
                    <div class="medal-level"
                        :style="{backgroundColor: medal?.color}"
                    >
                        <div>{{ medal?.name }}</div>
                        <div :style="{fontWeight: '1000', transform: 'scale(1.2)'}">{{ medal?.level }}</div>
                    </div>
                </div> 
                <div class="message" v-if="text || emoticon" :style="{ backgroundColor: props.accentColor }">
                    <span v-if="type === 'text' && text" :style="{ fontSize: props.fontSize + 'px' }">{{ text }}</span>
                    <div class="emote" v-if="emoticon"><BiliImg :src="emoticon" :use-disk="true"/></div>
                </div>
            </div>
        </div>
        <ScItem class="super-chat" v-if="type === 'sc'" :face="user.face" :name="user.name" :price="sc?.price" :text="text"/>
    </div>
</template>

<script lang="ts" setup>
import BiliImg from './BiliImg.vue'
import ScItem from './ScItem.vue';
import { img } from '../detail/Assets.ts';
import { computed } from 'vue';

const props = withDefaults(defineProps<{
    text?: string,
    user: {
        uid: number,
        face: string,
        name: string,
    }
    emoticon: string | null,
    medal: {
        level: number,
        name: string,
        color: string,
        guard_level: number,
    } | null,
    type: 'sc' | 'text' | 'emote'
    sc: {
        time: number,
        id: number,
        price: number,
    } | null
    hlColor?: string,
    accentColor?: string,
    fontSize?: number,
    bgColor?: string,
}>(), {
    hlColor: 'white',
    fontSize: 16,
    accentColor: 'pink',
    bgColor: 'transparent'
})

const colors = computed(() => ({
    '--hl-color': `${props.hlColor}`,
    '--accent-color': `${props.accentColor}`
}))

function getNameColor(guard_level: number | null) {
    switch (guard_level) {
        case 1:
            return '#ff0000'
        case 2:
            return '#b753f4'
        case 3:
            return '#00a1f3'
        default:
            return ''
    }
}

function getFontWeight(l: number | null):string {
    if (l === 1 || l === 2 || l === 3) {
        return '1000'
    } else {
        return ''
    }
}

</script>

<style scoped>
.name {
    font-size: 0.85em;
}
.medal-level {
    display: flex;
    align-items: center;
    color: white;
    font-size: 10px;
    border-radius: 99px;
    height: 14px;
    padding: 0 4px;
    box-sizing: border-box;
    gap: 2px;
}
.emote {
    max-width: 3em;
}
.dan-box {
    display: flex;
    box-sizing: border-box;
    gap: 0.5em;
    margin: 0.5em 0;
}
.dan-box:has(.super-chat) {
    width: 100%;
}

.message {
    border: 2px solid var(--accent-color);
    border-radius: 0 8px 8px ;
    color: var(--hl-color);
    padding: 0.25em;
    overflow: hidden;
    width: auto;
}

.name-box{
    border-radius: 8px 8px 0 0;
    color: var(--accent-color);
    display: flex;
    align-items: center;
    gap: 5px
}
.avater-box {
    width: 36px;
    min-width: 36px;
    max-width: 36px;
    aspect-ratio: 1;
    border-radius: 18px;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 1em;
    overflow: hidden;
    border: 1px solid var(--accent-color);
}
.avater {
    width: 100%;
    height: 100%;
    display: block;
}
.avater :deep(img) {
    width: 100%;
    height: 100%;
}
.danmu {
    display: flex;
    gap: 0.5em;
    width: 100%;
}
.right-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex-grow: 1;
    min-width: 0;
}

/* ── 入场分阶段动画 ──────────────────────────── */
/* 仅在 TransitionGroup 注入 chat-enter-active 时触发 */

.chat-enter-active .message {
    animation: bubble-in 0.35s ease-out;
}

.chat-enter-active .name-box,
.chat-enter-active .message span {
    animation: text-in 0.2s 0.25s ease-out both;
}

@keyframes bubble-in {
    from { max-width: 1.5em; }
    to   { max-width: 100em; }
}

@keyframes text-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}
</style>