// ── LiveAudio 编排层 ──────────────────────────────────
// 连接 FLV 解复用器、WebCodecs 解码器、AudioContext 调度器、Canvas 渲染器。
// 对外提供统一的音频/视频播放 API。
// 从 flv.js 架构重构。

import { ref } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import settings from './Setting'
import { error as logError, warn as logWarn, info as logInfo } from '../utility/logger'

import { FlvDemuxer, type AudioTrack, type VideoTrack } from './av/FlvDemuxer'
import { AacDecoder, type AacDecoderConfig } from './av/AudioDecoder'
import { AvcDecoder, type AvcDecoderConfig } from './av/VideoDecoder'
import { AudioScheduler } from './av/AudioScheduler'
import { VideoScheduler } from './av/VideoScheduler'
import { VideoRenderer } from './av/VideoRenderer'
import { MediaInfo } from './av/MediaInfo'
import { getSilentFrame } from './av/AacSilent'

// ── 响应式状态 ─────────────────────────────────────────

/** 流是否已准备（Channel 已注册到 Rust，管线就绪） */
const streamActive = ref(false)
/** 音频播放是否激活 */
const isPlaying = ref(false)
/** 视频播放是否激活 */
const isVideoPlaying = ref(false)
/** 当前房间 ID */
const audioRoomId = ref(0)
/** 媒体信息（对外暴露） */
const mediaInfo = ref<MediaInfo | null>(null)

// ── 管线实例 ───────────────────────────────────────────

let demuxer: FlvDemuxer | null = null
let audioDecoder: AacDecoder | null = null
let scheduler: AudioScheduler | null = null
let videoDecoder: AvcDecoder | null = null
let videoRenderer: VideoRenderer | null = null
let videoScheduler: VideoScheduler | null = null
let videoCanvas: HTMLCanvasElement | null = null

// ── 音频轨道状态（用于间隙检测） ──────────────────────

let lastAudioPts = -1
const GAP_THRESHOLD_MS = 50
let storedAudioCodec: string | null = null
let storedChannelCount: number | null = null
let storedSampleRate = 44100

// ── 视频解码器配置缓存（视频延迟启动时复用） ──────────

let videoAvcConfig: AvcDecoderConfig | null = null

// ── Canvas 绑定 ────────────────────────────────────────

function bindVideoCanvas(canvas: HTMLCanvasElement): void {
    videoCanvas = canvas
    videoRenderer?.bindCanvas(canvas)
}

function unbindVideoCanvas(): void {
    videoCanvas = null
    videoRenderer?.unbindCanvas()
}

// ── Rust 通信 ──────────────────────────────────────────

async function syncTrackActive(): Promise<void> {
    if (!streamActive.value) return
    try {
        await invoke('set_track_active', {
            audio: isPlaying.value,
            video: isVideoPlaying.value,
        })
    } catch (e) {
        logError(`[LiveAudio] set_track_active 失败: ${e}`)
    }
}

function resetDemuxer(): void {
    demuxer?.reset()
    videoAvcConfig = null
    lastAudioPts = -1
}

// ── 静音帧插入（音频间隙填充） ────────────────────────

function insertSilentFrames(fromPts: number, toPts: number): void {
    if (!storedAudioCodec || !storedChannelCount || !audioDecoder) return

    // 每帧时长（AAC: 1024 samples / sampleRate）
    const frameDuration = (1024 / storedSampleRate) * 1000 // ms
    const numFrames = Math.ceil((toPts - fromPts) / frameDuration)
    if (numFrames <= 0 || numFrames > 20) return // 最多插入 20 帧

    const silentBytes = getSilentFrame(storedAudioCodec, storedChannelCount)
    if (!silentBytes) {
        logWarn('[LiveAudio] 无法生成静音帧')
        return
    }


    for (let i = 0; i < numFrames; i++) {
        const pts = fromPts + i * frameDuration
        audioDecoder.decode(silentBytes, Math.round(pts))
    }
}

// ── 流管理 ─────────────────────────────────────────────

async function prepareStream(roomId: number): Promise<void> {
    await stopStream()

    streamActive.value = true
    audioRoomId.value = roomId

    // 创建管线
    demuxer = new FlvDemuxer()
    audioDecoder = new AacDecoder()
    scheduler = new AudioScheduler({ bufferTarget: 1.0, scheduleAheadMax: 2.0 })
    scheduler.setVolume((settings.volume.value ?? 50) / 100)

    // ── 接线：解复用器 → 解码器 → 调度器 ────────────

    // 元数据回调
    demuxer.onMetaDataArrived = (_meta) => {
        mediaInfo.value = demuxer!.mediaInfo
    }

    demuxer.onMediaInfo = (info) => {
        mediaInfo.value = info
        logInfo(`[LiveAudio] MediaInfo 就绪: ${info.hasAudio ? '有音频' : '无音频'}, ${info.hasVideo ? '有视频' : '无视频'}`)
    }

    // 轨道元数据 → 配置解码器
    demuxer.onTrackMetadata = (type, meta) => {
        if (type === 'audio') {
            const m = meta as import('./av/FlvDemuxer').AudioMetadata
            storedAudioCodec = m.codec
            storedChannelCount = m.channelCount
            storedSampleRate = m.audioSampleRate

            const config: AacDecoderConfig = {
                codec: m.codec,
                sampleRate: m.audioSampleRate,
                numberOfChannels: m.channelCount,
                description: m.config,
            }
            audioDecoder!.configure(config)
        } else {
            const m = meta as import('./av/FlvDemuxer').VideoMetadata
            videoAvcConfig = {
                codec: m.codec,
                description: m.avcc,
                codedWidth: m.codecWidth,
                codedHeight: m.codecHeight,
            }
            if (videoDecoder) {
                videoDecoder.configure(videoAvcConfig)
            }
        }
    }

    // 解复用数据 → 分发到解码器
    demuxer.onDataAvailable = (audioTrack: AudioTrack, videoTrack: VideoTrack) => {
        // ── 音频样本 ──
        for (const sample of audioTrack.samples) {
            // 间隙检测
            if (lastAudioPts >= 0 && sample.pts - lastAudioPts > GAP_THRESHOLD_MS) {
                insertSilentFrames(lastAudioPts + 1, sample.pts - 1)
            }
            lastAudioPts = sample.pts
            audioDecoder!.decode(sample.unit, sample.pts)
        }

        // ── 视频样本 ──
        if (videoDecoder) {
            for (const sample of videoTrack.samples) {
                videoDecoder.decode(sample.rawData, sample.pts, sample.isKeyframe)
            }
        }
    }

    demuxer.onError = (type, msg) => {
        logWarn(`[LiveAudio] FLV demuxer 错误 [${type}]: ${msg}`)
    }

    // ── 音频解码器输出 → 调度器 ──
    audioDecoder!.onFrame = (frame) => {
        scheduler!.play(frame, frame.timestamp / 1000)
    }

    audioDecoder!.onError = (err) => {
        logError(`[LiveAudio] AacDecoder 不可恢复错误: ${err.message}`)
    }

    // ── 视频解码器输出 → 视频调度器 ──
    // （在 startVideo 中设置）

    // ── Channel 接收 Rust 端推送的 FLV 字节 ──
    const channel = new Channel<number[]>()
    let frameCount = 0

    channel.onmessage = (data: number[]) => {
        if (!streamActive.value) return
        const bytes = new Uint8Array(data)
        frameCount++
        demuxer!.feed(bytes)
    }

    logInfo(`[LiveAudio] 准备流 room=${roomId}`)
    try {
        await invoke('prepare_audio_stream', { roomId, streamChannel: channel })
        logInfo(`[LiveAudio] 流管线就绪`)
    } catch (e) {
        streamActive.value = false
        logError(`[LiveAudio] 准备流错误: ${e}`)
        throw e
    }
}

async function stopStream(): Promise<void> {
    if (!streamActive.value) return
    streamActive.value = false
    isPlaying.value = false
    isVideoPlaying.value = false

    audioDecoder?.close()
    audioDecoder = null
    scheduler?.reset()
    scheduler = null
    demuxer?.reset()
    demuxer = null

    videoScheduler?.reset()
    videoScheduler = null
    videoRenderer?.dispose()
    videoRenderer = null
    videoDecoder?.close()
    videoDecoder = null

    videoAvcConfig = null
    lastAudioPts = -1

    invoke('stop_audio_stream').catch((err) => {
        logError(`[LiveAudio] stop_audio_stream 调用失败: ${err}`)
    })
}

// ── 音频播放控制 ──────────────────────────────────────

async function setAudioActive(active: boolean): Promise<void> {
    if (!streamActive.value) return
    const wasPulling = isPlaying.value || isVideoPlaying.value
    isPlaying.value = active
    const nowPulling = isPlaying.value || isVideoPlaying.value

    if (!wasPulling && nowPulling) {
        resetDemuxer()
    }
    // 立即控制 AudioContext：激活→恢复，停用→挂起
    if (active) {
        scheduler?.resume()
    } else {
        scheduler?.suspend()
    }
    if (wasPulling !== nowPulling) {
        await syncTrackActive()
    }
}

// ── 视频播放控制 ──────────────────────────────────────

function startVideo(): void {
    if (!streamActive.value) return

    // 已有视频管线在运行
    if (videoDecoder && videoScheduler && videoRenderer) {
        if (videoCanvas) videoRenderer.bindCanvas(videoCanvas)
        if (!isVideoPlaying.value) {
            setVideoActive(true)
        }
        return
    }

    videoDecoder = new AvcDecoder()
    videoRenderer = new VideoRenderer()
    videoScheduler = new VideoScheduler()
    if (videoCanvas) videoRenderer.bindCanvas(videoCanvas)

    // 延迟配置：如果 AVCC 已收到
    if (videoAvcConfig) {
        videoDecoder!.configure(videoAvcConfig)
    }

    // 接线：音频时间参考
    videoScheduler!.setAudioTiming(
        () => scheduler?.getCurrentPts() ?? 0,
        () => scheduler?.getAudioClock() ?? 0,
    )
    videoScheduler!.setRenderCallback((frame) => {
        if (isVideoPlaying.value) {
            videoRenderer?.draw(frame)
        } else {
            frame.close()
        }
    })

    // 接线：视频解码器输出 → 调度器
    videoDecoder!.onFrame = (frame) => {
        videoScheduler!.play(frame, frame.timestamp / 1000)
    }

    videoDecoder!.onError = (err) => {
        logError(`[LiveAudio] AvcDecoder 不可恢复错误: ${err.message}`)
    }

    setVideoActive(true)
}

async function setVideoActive(active: boolean): Promise<void> {
    if (!streamActive.value) return
    const wasPulling = isPlaying.value || isVideoPlaying.value
    isVideoPlaying.value = active
    const nowPulling = isPlaying.value || isVideoPlaying.value

    if (!wasPulling && nowPulling) {
        resetDemuxer()
    }
    if (wasPulling !== nowPulling) {
        await syncTrackActive()
    }
}

function stopVideo(): void {
    if (isVideoPlaying.value) {
        setVideoActive(false)
    }
    videoRenderer?.dispose()
    videoScheduler?.reset()
    videoScheduler = null
    videoRenderer = null
    videoDecoder?.close()
    videoDecoder = null
}

// ── 音量控制 ──────────────────────────────────────────

function setVolume(v: number): void {
    scheduler?.setVolume(v)
}

function getVolume(): number {
    return scheduler?.volume ?? settings.volume.value / 100
}

function mute(): void {
    scheduler?.mute()
}

function unmute(): void {
    scheduler?.unmute()
}

function toggleMute(): boolean {
    return scheduler?.toggleMute() ?? false
}

function isMuted(): boolean {
    return scheduler?.muted ?? false
}

// ── 便捷方法 ──────────────────────────────────────────

async function pauseAudio(): Promise<void> {
    if (!isPlaying.value) return
    const rid = audioRoomId.value
    await setAudioActive(false)
    audioRoomId.value = rid
}

async function resumeAudio(): Promise<void> {
    if (isPlaying.value || !audioRoomId.value || !streamActive.value) return
    await setAudioActive(true)
}

async function togglePlayPause(): Promise<void> {
    if (isPlaying.value) {
        await pauseAudio()
    } else if (audioRoomId.value && streamActive.value) {
        await resumeAudio()
    }
}

function setCurrentRoomId(id: number): void {
    audioRoomId.value = id
}

// ── 导出 ──────────────────────────────────────────────

export default {
    // 状态
    isPlaying,
    isVideoPlaying,
    audioRoomId,
    streamActive,
    mediaInfo,

    // 流管理
    prepareStream,
    stopStream,
    setAudioActive,
    setVideoActive,

    // 视频
    startVideo,
    stopVideo,
    bindVideoCanvas,
    unbindVideoCanvas,

    // 音量
    setVolume,
    getVolume,
    mute,
    unmute,
    toggleMute,
    isMuted,

    // 便捷方法
    pauseAudio,
    resumeAudio,
    togglePlayPause,
    setCurrentRoomId,
} as const
