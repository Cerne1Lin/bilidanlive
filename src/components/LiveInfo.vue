<template>
    <div class="container" :style="cssVars">
        <div class="main-box" :class="{ 'collapsed': Immersive.isImmersive.value }">
            <div class="live-snapshot" 
                v-show="isConnected"
                :style="{width: isFullscreen?'90%':''}"
            >
                <BiliImg v-show="!isVideoPlaying" :src="roomInfo?.keyframe"/>
                <canvas ref="videoCanvasRef" v-show="isVideoPlaying"></canvas>
                <div class="shadow-mask"></div>
                <span class="pro" @click="emit('togglePlay')"><SvgIcon :svg-raw="isPlaying?svg.pauseSvg:svg.playSvg" /></span>
                <div class="fullscreen" 
                    @click="isFullscreen = !isFullscreen"
                    v-show="isVideoPlaying"
                >
                    <SvgIcon :svg-raw="isFullscreen?svg.fullscreenExitSvg:svg.fullscreenSvg"/></div>
            </div>
            <div class="info" v-show="!isFullscreen">
                <div class="title" @dblclick="startEdit" :class="{'text':isConnected && !isEditing}">
                    <span v-if="isConnected && !isEditing">{{ props.roomInfo?.title || '未命名直播间' }}</span>
                    <input
                        v-if="isEditing || !isConnected"
                        ref="roomInputRef"
                        id="room-input"
                        :placeholder="isConnecting ? '连接中...' : '输入房间号'"
                        :style="{color: props.accentColor}"
                        :value="roomId"
                        :disabled="isConnecting"
                        @keyup.enter="onEnter"
                        @input="onRoomInput"
                        @blur="endEdit"
                    />
                </div>
                <div class="live-time" v-show="isConnected">{{ liveTitle }}</div>
                <div class="popularity" v-show="isConnected"><span>{{ subTitle }}</span></div>
            </div>
        </div>
        <div class="tool-bar" :class="{'collapsed': !(isConnected || Immersive.isImmersive.value)}">
            <div class="tool-btn" title="静音"><SvgIcon :svg-raw="isMute?svg.volumeMuteSvg:svg.volumeSvg" @click="emit('toggleMute')" /></div>
            <input
                class="volume-slider"
                type="range"
                :title="'音量:' + Math.round(volume * 100)"
                min="0"
                max="100"
                :value="Math.round((isMute ? 0 : volume) * 100)"
                :style="{ background: `linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${Math.round((isMute ? 0 : volume) * 100)}%, transparent ${Math.round((isMute ? 0 : volume) * 100)}%, transparent 100%)` }"
                @input="onVolumeInput"
            />
            <div class="tool-btn"
                @click="emit('toogleAudioOnly')"
            >
                <SvgIcon :svg-raw="svg.headphonesSvg" :style="{color: isAudioOnly?accentColor:''}"/>
            </div>
            <div class="tool-btn" @click="emit('toggleDanmu')" :title="showDanmu?'断开弹幕连接':'连接弹幕'"><SvgIcon :svg-raw="svg.messageSvg"
                :style="{color: showDanmu?accentColor:''}"/></div>
            <div class="tool-btn" @click="Immersive.toggleImmersive(summary)" ><SvgIcon :svg-raw="Immersive.isImmersive.value?svg.immersiveDisableSvg:svg.immersiveSvg" /></div>
            <div class="tool-btn" @click="toggleWindowTransparent()"><SvgIcon :svg-raw="svg.transparentSvg"/></div>
            <div class="tool-btn" @click="emit('openBiliLiveRoom', roomInfo?roomInfo.room_id:null)" title="在浏览器中打开"><SvgIcon :svg-raw="svg.openSvg" /></div>
            <div class="tool-btn" @click="emit('flush')" title="刷新"><SvgIcon :svg-raw="svg.flushSvg" /></div>
            <div class="tool-btn" @click="closeAll" title="关闭"><SvgIcon :svg-raw="svg.closeSvg" /></div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { svg } from '../detail/Assets'
import BiliImg from './BiliImg.vue'
import SvgIcon from './SvgIcon.vue'
import { addTip } from '../utility/tip.ts'
import { toggleWindowTransparent } from '../detail/WindowControl.ts'
import Immersive from '../detail/Immersive.ts'
import { radius } from '../detail/Theme.ts'

// ── RoomInfo 类型（与 Rust 端一致）──────────────────

export interface RoomInfo {
    uid: number
    room_id: number
    online: number
    live_status: number
    area_name: string
    parent_area_name: string
    title: string
    user_cover: string
    keyframe: string
    live_time: string
    user_info?: {
        uid: number
        uname: string
        face: string
    }
}
const isFullscreen = ref(false)

// ── Props（父组件传入的展示状态）────────────────────

const props = withDefaults(defineProps<{
    roomInfo?: RoomInfo | null
    isMute?: boolean
    volume?: number        // 0..1
    showDanmu?: boolean
    isConnecting?: boolean
    isConnected?: boolean
    roomId?: number
    isPlaying?: boolean
    isVideoPlaying?: boolean
    isAudioOnly?: boolean
    onLinkToRoom?: (roomId: number) => Promise<boolean>,
    accentColor?: string,
    bgColor?: string,
    hlColor?: string,
}>(), {
    showTitle: false,
    isMute: false,
    volume: 1,
    showDanmu: true,
    isConnecting: false,
    isConnected: false,
    isVideoPlaying: false,
    accentColor: 'pink',
    bgColor: 'transparent',
    hlColor: 'white',
})
const cssVars = computed(() => ({
    '--hl-color': `${props.hlColor}`,
    '--accent-color': `${props.accentColor}`,
    '--bg-color': `${props.bgColor}`,
    '--radius': radius.value
}))
const summary = computed(() => {
    if (props.roomInfo) {
        if (props.roomInfo.user_info) {
            return props.roomInfo.user_info.uname + ': ' + props.roomInfo.title + ' - ' + props.roomInfo.area_name
        }
        return props.roomInfo.title + ' - ' + props.roomInfo.area_name
    } 
    return ''
})

// ── Emits（所有用户操作通过事件通知父组件）─────────

const emit = defineEmits<{
    (e: 'toggleMute'): void
    (e: 'volumeChange', volume: number): void
    (e: 'toggleDanmu'): void
    (e: 'togglePlay'): void
    (e: 'disconnectAll'): void
    (e: 'openBiliLiveRoom', rommId: number | null): void
    (e: 'flush'): void
    (e: 'toogleAudioOnly'):void
}>()

// ── 本地 UI 状态 ───────────────────────────────────

const roomId = ref('')
const isEditing = ref(false)
const roomInputRef = ref<HTMLInputElement | null>(null)
const videoCanvasRef = ref<HTMLCanvasElement | null>(null)

// 暴露 canvas 供父组件绑定到 LiveAudio
defineExpose({ videoCanvas: videoCanvasRef })

function startEdit() {
    isEditing.value = true
    nextTick(() => roomInputRef.value?.focus())
}

function endEdit() {
    isEditing.value = false
}

function onRoomInput(e: Event) {
    roomId.value = (e.target as HTMLInputElement).value
}

async function onEnter() {
    const id = Number(roomId.value)
    if (isNaN(id) || id <= 0) return
    try {
        if (props.onLinkToRoom) {
            const success = await props.onLinkToRoom(id)
            if (success) {
                roomId.value = ''
                endEdit()
            }
        }
    } catch(err) {
        addTip(String(err), 'error', -1)
    }
}

function onVolumeInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value) / 100
    emit('volumeChange', v)
}

// ── 实时已开播时间 ───────────────────────────────

const now = ref(Date.now())
const timer = setInterval(() => { now.value = Date.now() }, 1000)
onUnmounted(() => clearInterval(timer))

const liveDuration = computed(() => {
    if (!props.roomInfo?.live_time) return ''
    const start = Date.parse(props.roomInfo.live_time.replace(' ', 'T'))
    if (isNaN(start)) return props.roomInfo.live_time
    const elapsed = Math.max(0, Math.floor((now.value - start) / 1000))
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0')
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    if (h !== '00') return `${h}:${m}:${s}`
    return `${m}:${s}`
})

const liveTitle = computed(() => {
    const name = props.roomInfo?.user_info?.uname ?? ''
    return (props.roomInfo?.live_status ?? 0) === 1 ? `${name} - ${liveDuration.value}` : `${name} - 未开播`
})

const subTitle = computed(() => {
    if (props.roomInfo) {
        if (props.showDanmu) {
            return props.roomInfo.area_name + ' ·⍜· ' + props.roomInfo.online
        } else {
            return props.roomInfo.area_name
        }
    } else {
        return ''
    }
})

function closeAll() {
    isFullscreen.value = false
    if (Immersive.isImmersive.value) {
        Immersive.toggleImmersive('')
    }
    emit('disconnectAll')
}

</script>

<style scoped>
.fullscreen {
    position: absolute;
    top: 5%;
    right: 3%;
    height: 1.2em;
    aspect-ratio: 1;
    color: var(--accent-color);
    opacity: 0;
    transition: transform 0.3s ease;
}
.fullscreen:hover {
    transform: scale(1.2);
}
.live-snapshot:hover .fullscreen {
    opacity: 1;
    pointer-events: auto;
}
.volume-container {
    display: flex;
    align-items: center;
    gap: 5px;
}
.live-time {
    color: rgb(199, 199, 199);
    font-size: 0.7em;
}
.container {
    display: flex;
    flex-direction: column;
    justify-items: center;
    border: 2px solid var(--accent-color);
    border-radius: 0 0 var(--radius) var(--radius);
    background-color: var(--bg-color);
}
.live-snapshot :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.live-snapshot canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.tool-btn.sub {
    color: var(--accent-color);
}
.tool-btn {
    height: 1.2em;
    aspect-ratio: 1;
    color: var(--hl-color);
    cursor: pointer;
}
.tool-btn:hover {
    color: var(--accent-color);
}
.tool-btn :deep(svg) {
    height: 100%;
}
.tool-bar {
    display: flex;
    align-items: center;
    position: relative;
    min-height: 1.5em;
    padding: 5px;
    justify-content: space-around;
    border-top: 1px solid var(--accent-color);
    transition: max-height 0.4s , min-height 0.4s linear, padding 0.4s linear, opacity 0.4s linear, border-width 0.4s linear;
}
.volume-slider {
    height: 5px;
    appearance: none;
    background: transparent;
    border-radius: 99px;
    cursor: pointer;
    max-width: 8em;
    border: 1px solid var(--accent-color);
}
.volume-slider::-webkit-slider-thumb {
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent-color);
    cursor: pointer;
}
.main-box {
    min-height: 6.5em;
    background-color: transparent;
    display: flex;
    padding: 1em;
    box-sizing: border-box;
    gap: 1em;
    overflow: hidden;
    max-height: 100%;
    justify-content: space-around;
    transition: max-height 0.4s linear, min-height 0.4s linear, padding 0.4s linear, opacity 0.4s linear, border-width 0.4s linear;
}
.collapsed {
    max-height: 0;
    min-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    border-bottom-width: 0;
    opacity: 0;
}
.live-snapshot {
    width: 8em;
    height: auto;
    aspect-ratio: 16 / 9;
    flex-shrink: 0;
    align-self: flex-start;
    border: 2px solid var(--accent-color);
    border-radius: 10px;
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
}
.info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-grow: 1;
    min-width: 0;
}
.title {
    border-radius: 5px;
    border: 2px solid var(--accent-color);
    height: 2em;
    align-items: center;
    display: flex;
    font-size: 0.9em;
    color: var(--accent-color);
    position: relative;
    overflow: hidden;
}
.title.text {
    border: none;
}
.title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 0.5em;
}
.popularity {
    color: var(--hl-color);
    font-size: 0.7em;
}
.pro {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    height: 2em;
    aspect-ratio: 1;
    color: var(--accent-color);
    -webkit-user-drag: none;
    opacity: 0;
    transition: opacity 0.2s;
    transition: transform 0.2s;
    display: block;
}
.pro:hover {
    transform: translate(-50%, -50%) scale(1.2);
    cursor: pointer;
}
.live-snapshot:hover .pro {
    opacity: 1;
    pointer-events: auto;
}
.pro svg {
    display: block;
    width: 100%;
    height: 100%;
}
.live-snapshot:hover .shadow-mask {
    position: absolute;
    inset: 0;
    background-color: rgba(200,200,200,0.2);
    backdrop-filter: blur(1px);
    border-radius: 10px;
    user-select: none;
}
#room-input {
    position: absolute;
    inset: 0;
    background-color: transparent;
    border: none;
    font-size: 1em;
    padding-left: 0.5em;
    color: var(--hl-color);
    border-radius: 5px;
}
#room-input::placeholder {
    color: rgba(255, 255, 255, 0.732);
}
</style>
