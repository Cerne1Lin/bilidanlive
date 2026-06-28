import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { RoomInfo } from '../components/LiveInfo.vue'
import LiveWs from './LiveWs'
import LiveAudio from './LiveAudio'
import { addDanmu, clearDanmu, notifyHistoryLoaded, type DanmuItem } from './DanData'
import { clearSc } from './SuperChat.ts'
import { addTip } from '../utility/tip'
import { addLocalHistory } from './HistoryList'
import settings from './Setting'

/**
 * 直播间控制逻辑（composable）
 * Personal.vue / Home.vue 共用
 */
export function useLiveControl() {
    const roomInfo = ref<RoomInfo | null>(null)
    const isMute = ref(false)
    const volume = ref(LiveAudio.getVolume())
    const isConnecting = ref(false)
    const isConnected = ref(false)
    const currentRoomId = ref(0)
    const audioOnly = ref(settings.audioOnly.value)
    const isPlaying = computed(() => {
        return LiveAudio.isPlaying.value || LiveAudio.isVideoPlaying.value
    })

    function toggleAudioOnly() {
        if (audioOnly.value) {
            setAudioOnly(false)
        } else {
            setAudioOnly(true)
        }
    }

    /** 设置是否仅播放音频（运行时切换 + 持久化：若正在播放视频则立即停止） */
    function setAudioOnly(val: boolean) {
        audioOnly.value = val
        settings.audioOnly.value = val
        if (val && LiveAudio.isVideoPlaying.value) {
            LiveAudio.stopVideo()
        } else if (!val && LiveAudio.isPlaying.value && !LiveAudio.isVideoPlaying.value) {
            LiveAudio.startVideo()
        }
    }

    /** 绑定视频 canvas（从 LiveInfo 组件获取） */
    function bindVideoCanvas(canvas: HTMLCanvasElement) {
        LiveAudio.bindVideoCanvas(canvas)
    }

    /** 输入房间号 → 连接弹幕 + 准备音频流 */
    async function linkToRoom(roomId: number): Promise<boolean> {
        // 同房间且已连接，跳过
        if (currentRoomId.value === roomId && isConnected.value) return true
        if (isConnecting.value) return false
        isConnecting.value = true
        let result = false
        try {
            await LiveAudio.stopStream()
            await LiveWs.disconnectLiveRoom()
            clearDanmu()
            clearSc()

            // 房间信息（必需）+ 弹幕连接（根据设置）
            const tasks: Promise<any>[] = [
                invoke<{ code: number; data: RoomInfo | null }>('get_room_info', { roomId }),
            ];
            if (settings.autoLinkWss.value) {
                tasks.push(LiveWs.connectLiveRoom(roomId));
            } else {
                LiveWs.setCurrentRoomId(roomId)
            }
            const [infoRes] = await Promise.all(tasks);

            if (infoRes.data) {
                roomInfo.value = infoRes.data
                // 进入上报：已登录 → 服务器端记录；未登录 → 本地记录
                const loginStatus = await invoke<{ logged_in: boolean }>('get_login_status').catch(() => ({ logged_in: false }))
                if (loginStatus.logged_in) {
                    invoke('record_room_entry', { roomId }).catch(() => {})
                } else {
                    addLocalHistory(infoRes.data)
                }
            }
            isConnected.value = true
            currentRoomId.value = roomId

            // 历史弹幕（非必需，失败不影响实时弹幕）
            fetchHistoryDanmu(roomId)

            // 进入房间时从设置同步 audioOnly 状态
            audioOnly.value = settings.audioOnly.value

            if (roomInfo.value?.live_status === 1 && settings.autoPlay.value) {
                // 准备音频流（传递 Channel 给 Rust，立即返回）
                await LiveAudio.prepareStream(roomId)
                // 激活音频拉流
                await LiveAudio.setAudioActive(true)
                // 视频：非纯音频模式时启动
                if (!audioOnly.value) LiveAudio.startVideo()
            } else {
                LiveAudio.setCurrentRoomId(roomId)
            }
            result = true
        } catch (e) {
            isConnected.value = false
            currentRoomId.value = 0
            addTip(`连接失败: ${e}`, 'error', -1)
            result = false
        } finally {
            isConnecting.value = false
            return result
        }
    }

    async function disconnectAll() {
        await LiveAudio.stopStream()
        await LiveWs.disconnectLiveRoom()
        isConnected.value = false
        currentRoomId.value = 0
    }

    /** 刷新：重拉房间信息 + 重连 WSS/音频，不清弹幕 */
    async function flushAll(roomId: number) {
        try {
            const [infoRes] = await Promise.all([
                invoke<{ code: number; data: RoomInfo | null }>('get_room_info', { roomId }),
                LiveAudio.stopStream(),
                LiveWs.disconnectLiveRoom(),
            ])

            await Promise.all([
                LiveWs.connectLiveRoom(roomId),
                (async () => {
                    if (infoRes.data) roomInfo.value = infoRes.data
                })(),
            ])
            if (settings.autoPlay && roomInfo.value?.live_status === 1) {
                // 准备流并激活播放
                await LiveAudio.prepareStream(roomId)
                await LiveAudio.setAudioActive(true)
                if (!audioOnly.value) LiveAudio.startVideo()
            }
            addTip('刷新成功', 'success', 2)
        } catch (e) {
            addTip(`刷新失败: ${e}`, 'error', 3)
        }
    }

    /** 拉取历史弹幕 */
    interface HistoryItem {
        text: string
        nickname: string
        timeline: string
        uid: number
        face: string
        medal: { level: number; name: string; color: string; guard_level: number } | null
        emoticon: { url: string; desc: string } | null
        type: 'text' | 'emote'
    }

    async function fetchHistoryDanmu(roomId: number) {
        try {
            const list = await invoke<HistoryItem[]>('get_history_danmu', { roomId })
            for (const h of list) {
                const item: DanmuItem = {
                    id: 0,
                    ts: 0,
                    text: h.text,
                    nickname: h.nickname,
                    timeline: h.timeline,
                    medal: h.medal,
                    user: { uid: h.uid, face: h.face, name: h.nickname },
                    emoticon: h.emoticon,
                    type: h.type,
                    sc: null,
                }
                addDanmu(item)
            }
            notifyHistoryLoaded()
        } catch {
            // 历史弹幕获取失败不影响实时流
        }
    }

    /** 静音切换 */
    function toggleMuteLocal() {
        isMute.value = LiveAudio.toggleMute()
    }

    /** 音量变化（setVolume 内部自动取消静音，同时持久化到设置） */
    function changeVolume(v: number) {
        volume.value = v
        LiveAudio.setVolume(v)
        if (isMute.value) {
            isMute.value = false
        }
        settings.volume.value = Math.round(v * 100)
    }

    /** 弹幕开关 */
    async function toggleDanmu() {
        await LiveWs.toggleConnect()
    }

    /** 切换播放/暂停 */
    async function togglePlayPause() {
        if (isPlaying.value) {
            // 暂停：完全断开 FLV 流
            await LiveAudio.stopStream()
        } else if (LiveAudio.audioRoomId.value) {
            // 恢复：重新准备流 + 激活播放
            await LiveAudio.prepareStream(LiveAudio.audioRoomId.value)
            await LiveAudio.setAudioActive(true)
            if (!audioOnly.value) {
                LiveAudio.startVideo()
            }
        }
    }

    // 实时人气同步到 roomInfo.online
    watch(LiveWs.liveOnline, (v) => {
        if (roomInfo.value) {
            roomInfo.value = { ...roomInfo.value, online: v }
        }
    })
    const danmuStatus = LiveWs.isConnected
    return {
        roomInfo,
        isMute,
        volume,
        isConnecting,
        isConnected,
        currentRoomId,
        danmuStatus,
        linkToRoom,
        disconnectAll,
        flushAll,
        toggleMute: toggleMuteLocal,
        changeVolume,
        toggleDanmu,
        togglePlayPause,
        bindVideoCanvas,
        wsConnecting: LiveWs.isConnecting,
        wsConnected: LiveWs.isConnected,
        isAudioPlaying: LiveAudio.isPlaying,
        isVideoPlaying: LiveAudio.isVideoPlaying,
        isPlaying,
        audioOnly,
        setAudioOnly,
        toggleAudioOnly,
    }
}
