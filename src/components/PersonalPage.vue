<template>
    <div class="personal-container" :style="cssVars">
        <div class="personal-info" v-loading="isLoading.uLoading">
            <div class="personal-avater" title="进入空间" @click="openBiliSpace(userInfo.mid)"><BiliImg v-show="userInfo.face !== ''" :src="userInfo.face" :default="img.defaultFace" :use-disk="true"/></div>
            <div class="info-content">
                <div class="name"><span>{{ userInfo.uname }}</span></div>
                <div class="level"></div>
                <div class="login-btn" @click="signOrOut"
                    :title="userInfo.is_login?'退出登陆':'登陆'"
                >
                    <SvgIcon :svg-raw="userInfo.is_login?svg.logoutSvg:svg.loginSvg" />
                </div>
            </div>
        </div>
        <div class="sign-qrcode" v-if="showQrcode">
            <div class="qrcode-btns">
                <div class="qrcode-btn" id="qrcode-flush" @click="getQrcodeAndCheck" title="刷新"><SvgIcon :svg-raw="svg.flushSvg" /></div>
                <div class="qrcode-btn" @click="showQrcode = false" title="关闭"><SvgIcon :svg-raw="svg.closeSvg" /></div>
            </div>
            <QrcodeVue :value="qrcodeUrl" :size="200" :render-as="'svg'" :background="'transparent'" :foreground="hlColor"/>
            <div id="tip">{{ qrcodeTip }}</div>
        </div>
        <div class="live-now" :class="{ 'hide': followingLive.live_count === 0 }">
            <div class="live-item" v-for="item in followingLive.list" :title="item.uname + ':\n' + item.title" @click="emit('enterRoom', item.room_id)">
                <div class="live-icon"><span>Live</span></div>
                <div class="live-avater"><BiliImg :src="item.face" :default="img.defaultFace" :use-disk="true"/></div>
            </div>
        </div>
        <div class="bottom-container">
            <div class="bottom-title-bar">
                <div class="bottom-title-text">
                    <div class="page-item" @click="selectIndex = 0">
                        <SvgIcon :svg-raw="svg.liveSvg" :size="'20px'"/>
                        <span class="page-item-text" :class="{'hide':selectIndex !== 0}">{{ '正在直播 ' + followingLive.live_count }}</span>
                    </div>
                    <div class="page-item" :class="{ 'show':selectIndex === 1}" @click="selectIndex = 1">
                        <SvgIcon :svg-raw="svg.historySvg" :size="'16px'" />
                        <span class="page-item-text" :class="{'hide':selectIndex !==1}">{{ '历史记录' }}</span>
                    </div>
                </div>
                <div class="bottom-btns">
                    <div class="bottom-btn" :class="'flush'" title="刷新列表" @click="() => {emit('flush')}"><SvgIcon :svg-raw="svg.flushSvg" /></div>
                </div>
            </div>
            <div class="switch-container">
                <div class="live-full" v-loading="isLoading.fLoading" :class="{ 'page-hide': selectIndex !== 0, 'windows-scrollbar-hidden': isWindowsPlatform }">
                    <div class="live-full-item" v-for="item in followingLive.list">
                        <div class="face-name">
                            <div class="face" title="在浏览器中打开" @click="openBiliLiveRoom(item.room_id)"><BiliImg :src="item.face" :default="img.defaultFace" :use-disk="true"/></div>
                            <div class="name"><span>{{ item.uname }}</span></div>
                        </div>
                        <div class="room-cover-title" @click="emit('enterRoom', item.room_id)">
                            <div class="room-cover"><BiliImg :src="item.cover_url" :use-disk="true"/></div>
                            <div class="title-info">
                                <div class="title"><span>{{ item.title }}</span></div>
                                <div class="area-online"><span>{{ item.area_v2_name + ' · ' + formatOnline(item.online) + '人看过'}}</span></div>
                            </div>
                        </div>
                    </div>
                </div>
                <HistoryList class="history-list" :class="{'page-hide': selectIndex !== 1}" :items="historyItems" @enter-room="(id: number) => { emit('enterRoom', id) }" v-loading="isLoading.hLoading"/>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import QrcodeVue from 'qrcode.vue'
import { computed, ref, onUnmounted, onMounted } from 'vue'
import { getQrcode, checkQrcodeState, type QrcodeRes, type QrcodeState } from '../detail/Login'
import { svg } from '../detail/Assets'
import type { NavUserInfo } from '../detail/PersonalData'
import { FollowingLiveRes } from '../detail/FollowingLive'
import BiliImg from './BiliImg.vue'
import SvgIcon from './SvgIcon.vue'
import { addTip } from '../utility/tip.ts'
import { openBiliSpace, openBiliLiveRoom } from '../detail/Opener.ts'
import { img } from '../detail/Assets'
import HistoryList from './HistoryList.vue'
import { HistoryItem } from '../detail/HistoryList.ts'
import { radius } from '../detail/Theme.ts'
import { platform } from '../detail/WindowControl'

const props = withDefaults(defineProps<{
    userInfo: NavUserInfo,
    followingLive: FollowingLiveRes
    historyItems: HistoryItem[]
    isLoading: {
        uLoading: boolean,
        fLoading: boolean,
        hLoading: boolean,
    }
    accentColor?: string,
    bgColor?: string,
    hlColor?: string,
}>(), {
    accentColor: 'pink',
    bgColor: 'transparent',
    hlColor: 'white',
})
const isWindowsPlatform = computed(() => platform.value === 'windows')

const cssVars = computed(() => ({
    '--hl-color': `${props.hlColor}`,
    '--accent-color': `${props.accentColor}`,
    '--bg-color': `${props.bgColor}`,
    '--radius': radius.value
}))
const showQrcode = ref<boolean>(false)
const qrcodeUrl = ref<string>('')
const qrcodeTip = ref<string>('使用App扫描以登陆')
let canFlush: boolean = true;
const selectIndex = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

function clearPollTimer() {
    if (pollTimer !== null) {
        clearInterval(pollTimer)
        pollTimer = null
    }
}

const emit = defineEmits<{
    (e: 'loginSuccess'): void,
    (e: 'logout'): void,
    (e: 'flush'): void,
    (e: 'enterRoom', roomId: number): void,
}>()

async function pollQrcodeStatus(qrcodeKey: string) {
    try {
        clearPollTimer()
        pollTimer = setInterval(async () => {
            const state: QrcodeState = await checkQrcodeState(qrcodeKey)
            switch (state.status) {
                case 'success':
                    clearPollTimer()
                    showQrcode.value = false
                    selectIndex.value = 0
                    emit('loginSuccess')
                    break
                case 'scanned':
                    qrcodeTip.value = '已扫描，请在手机上确认'
                    canFlush = true
                    break
                case 'expired':
                    clearPollTimer()
                    qrcodeTip.value = '二维码已过期，请重新获取'
                    canFlush = true
                    break
                case 'unknown':
                    clearPollTimer()
                    qrcodeTip.value = state.message
                    canFlush = true
                    break
                case 'pending':
                default:
                    // 继续轮询，不操作
                    break
            }
        }, 2000)
    } catch (err) {
        addTip(String(err), 'error', 3)
    }
}

function getQrcodeAndCheck() {
    if (canFlush) {
        canFlush = false
        getQrcode().then((res: QrcodeRes) => {
            if (res.code === 0 && res.data) {
                qrcodeUrl.value = res.data.url
                qrcodeTip.value = '使用App扫描以登陆'
                showQrcode.value = true
                pollQrcodeStatus(res.data.qrcode_key)
            }
        }).catch((err) => {
            addTip(String(err),'error',3)
        })
    }
}

function signOrOut() {
    if (props.userInfo.is_login) {
        emit('logout')
    } else {
        getQrcodeAndCheck()
    }
}

onMounted(async () => {
    setTimeout(() => {
        if (!props.userInfo.is_login) {
            selectIndex.value = 1
        } else {
            selectIndex.value = 0
        }
    }, 500)
})

onUnmounted(() => {
    clearPollTimer()
})

function formatOnline(n: number): string {
    if (n < 1000) return String(n)
    if (n < 10000) return (n / 1000).toFixed(1) + 'k'
    return (n / 10000).toFixed(1) + 'w'
}


</script>

<style scoped>
.history-list {
    flex: 0 0 100%;
    margin-left: -100%;
    overflow-x: hidden;
    transition: transform 0.4s ease-out, opacity 0.3s ease-out;
}
.live-full.page-hide,
.history-list.page-hide {
    pointer-events: none;
}
.live-full.page-hide {
    transform: translateX(-100%);
    opacity: 0;
}
.history-list.page-hide {
    transform: translateX(100%);
    opacity: 0;
}
.switch-container {
    display: flex;
    border: 2px solid var(--accent-color);
    border-radius: 0 0 var(--radius) var(--radius);
    flex-grow: 1;
    min-height: 0;
    box-sizing: border-box;
    overflow: hidden;
    background-color: var(--bg-color);
}
.page-item-text {
    user-select: none;
    -webkit-user-select: none;
    white-space: nowrap;
    overflow: hidden;
    transition: opacity 0.3s ease-out;
}
.page-item-text.hide {
    opacity: 0;
}
.page-item {
    display: flex;
    align-items: center;
    padding: 0 0.5em;
    gap: 5px;
    box-sizing: border-box;
    width: 75%;
    flex-shrink: 0;
    transition: transform 0.3s ease-out;
}
.page-item.show {
    transform: translateX(-70%);
}
.bottom-btn.flush:hover {
    transform: rotate(180deg);
}
.bottom-btn {
    height: 80%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 50%;
    transition: transform 0.3s ease;
}
.bottom-btn:hover {
    background-color: rgba(255, 255, 255, 0.2);
}
.bottom-btn :deep(svg) {
    color: var(--accent-color);
    height: 80%;
    width: 80%;
}
.bottom-btns {
    height: 100%;
    display: flex;
    align-items: center;
    margin-left: auto;
    border-radius: 8px 8px 0 0;
    gap: 0.5em;
    box-sizing: border-box;
    color: var(--accent-color);
    border-bottom: none;
    padding: 0 0.5em;
}
.bottom-title-bar {
    display: flex;
    height: 2em;
    box-sizing: border-box;
    font-size: 0.9em;
    border-radius: 8px 8px 0 0;
    background-color: var(--bg-color);
    border: 2px solid var(--accent-color);
    border-bottom: none;
}
.bottom-title-text {
    color: var(--accent-color);
    border-bottom: none;
    display: flex;
    box-sizing: border-box;
    border-radius: 8px 8px 0 0;
    border-bottom: none;
    width: 8.8em;
    overflow: hidden;
}

.area-online {
    color: rgb(171, 171, 171);
    margin-top: auto;
    font-size: 0.6em;
}
.title {
    color: var(--hl-color);
    font-size: 0.8em;
}
.room-cover-title {
    display: flex;
    box-sizing: border-box;
    cursor: pointer;
}
.room-cover-title:hover .title {
    color: var(--accent-color);
}
.title-info {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    border: 1px solid var(--hl-color);
    border-radius: 0 10px 10px 0;
    border-left: none;
    padding: 0.6em;
    box-sizing: border-box;
}
.room-cover {
    aspect-ratio: 16/9;
    height: 5.5em;
    flex-shrink: 0;
    align-self: flex-start;
    border-radius: 10px 0 0 10px;
    border: 1px solid var(--accent-color);
    overflow: hidden;
}
.room-cover :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.face-name {
    display: flex;
    align-items: center;
    gap: 1em;
    font-size: 0.75em;
}
.live-full-item {
    display: flex;
    flex-direction: column;
    padding: 0.5em;
    gap: 0.2em;
    border-bottom: 1px solid rgba(255, 192, 203, 0.5);
}
.face {
    aspect-ratio: 1;
    width: 3em;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid var(--accent-color);
    box-sizing: border-box;
    cursor: pointer;
}
.face :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.face:hover :deep(img) {
    filter: brightness(0.7);
}
.qrcode-btns {
    display: flex;
    gap: 0.5;
    align-self: end;
}
.qrcode-btn {
    width: 1.5em;
    height: 1.5em;
    display: flex;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
    justify-items: center;
    cursor: pointer;
}
.qrcode-btn:hover {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 50%;
}
#qrcode-flush :deep(svg) {
    width: 1.2em;
    height: 1.2em;
}
.qrcode-btn :deep(svg) {
    width: 100%;
    height: 100%;
    color: var(--accent-color);
}
.login-btn {
    height: 2em;
    width: 2em;
    background-color: transparent;
    border: 2px solid var(--accent-color);
    color: var(--accent-color);
    font-size: 0.8em;
    border-radius: 99px;
    margin-left: auto;
    cursor: pointer;
}
.login-btn:hover {
    background-color: rgba(255, 255, 255, 0.2);
}
.bottom-container {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    overflow: hidden;
}
.live-full {
    flex: 0 0 100%;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-radius: 0 0 16px 16px;
    box-sizing: border-box;
    transition: transform 0.4s ease-out, opacity 0.3s ease-out;
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
.personal-container {
    display: flex;
    width: 100%;
    box-sizing: border-box;
    flex-direction: column;
    height: 100%;
    gap: 8px;
}
.sign-qrcode {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0.5em;
    border: 2px solid var(--accent-color);
    border-radius: var(--radius);
    flex-direction: column;
    gap: 2px;
    background-color: var(--bg-color);
}
#tip {
    color: var(--hl-color);
}
.info-content {
    display: flex;
    flex-grow: 1;
    align-items: center;
}
.personal-info {
    display: flex;
    width: 100%;
    padding: 1em;
    gap: 1em;
    border-radius: 0 0 var(--radius) var(--radius);
    border: 2px solid var(--accent-color);
    box-sizing: border-box;
    background-color: var(--bg-color);
}
.personal-avater {
    width: 3em;
    aspect-ratio: 1;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid var(--accent-color);
    cursor: pointer;
}
.personal-avater :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.personal-avater:hover :deep(img) {
    filter: brightness(0.7)
}
.name {
    font-size: 1.2em;
    color: var(--hl-color);
}
.name:hover {
    color: var(--accent-color);
}
.live-now {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    box-sizing: border-box;
    border-radius: var(--radius);
    border: 2px solid var(--accent-color);
    min-height: 4.5em;
    align-items: center;
    justify-items: center;
    padding: 0 0.5em;
    gap: 1em;
    transition: all 0.4s linear;
    background-color: var(--bg-color);
}
.live-now.hide {
    max-height: 0;
    min-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    border-width: 0;
    opacity: 0;
}
.live-item {
    height: 3em;
    position: relative;
    cursor: pointer;
}
.live-avater {
    height: 100%; 
    border: 2px solid var(--accent-color);
    border-radius: 1.5em;
    aspect-ratio: 1;
    box-sizing: border-box;
    overflow: hidden;
}
.live-avater :deep(img) {
    height: 100%;
}
.live-avater:hover :deep(img) {
    filter: brightness(0.7);
}
.live-icon {
    display: inline-block;
    position: absolute;
    top: 0em;
    right: 0.2em;
    color: var(--hl-color);
    background-color: var(--accent-color);
    border-radius: 0 0.5em 0 0.5em;
    padding: 0 0.25em;
    font-size: 0.7em;
    transition: transform 0.3s ease;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    z-index: 2;
}
.live-item:hover .live-icon {
    transform: scale(1.2);
}
</style>


<style>
.live-now::-webkit-scrollbar {
    display: none;
}

</style>