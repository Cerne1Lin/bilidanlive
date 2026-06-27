// ── 音频播放调度器 ────────────────────────────────────
// 基于 AudioContext + GainNode 的播放调度，带自适应缓冲和音量控制。
// 从 LiveAudio.ts 中提取并优化。

export interface SchedulerOptions {
    /** 开始播放前需要的缓冲时长（秒），默认 1.0 */
    bufferTarget?: number
    /** 最大提前调度时长（秒），默认 2.0 */
    scheduleAheadMax?: number
}

export class AudioScheduler {
    private ctx: AudioContext | null = null
    private gainNode: GainNode | null = null
    private nextTime = 0
    private _volume = 1
    private _muted = false
    private _preMuteVolume = 1

    private currentPts = 0
    private firstPts = -1
    private startPts = 0
    private startClock = 0

    private frameQueue: { frame: AudioData; pts: number }[] = []
    private bufferTarget: number
    private scheduleAheadMax: number
    private bufferedDuration = 0
    private scheduling = false
    private started = false
    private playCount = 0

    private scheduleTimerId: ReturnType<typeof setTimeout> | null = null

    constructor(options?: SchedulerOptions) {
        this.bufferTarget = options?.bufferTarget ?? 1.0
        this.scheduleAheadMax = options?.scheduleAheadMax ?? 2.0
    }

    // ── AudioContext 管理 ────────────────────────────────

    private async ensureCtx(): Promise<AudioContext> {
        if (!this.ctx) {
            this.ctx = new AudioContext()
            this.gainNode = this.ctx.createGain()
            this.gainNode.gain.value = this._muted ? 0 : this._volume
            this.gainNode.connect(this.ctx.destination)
        }
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume()
        }
        return this.ctx
    }

    reset(): void {
        this.nextTime = 0
        this.frameQueue = []
        this.bufferedDuration = 0
        this.scheduling = false
        this.started = false
        this.playCount = 0
        this.currentPts = 0
        this.firstPts = -1
        this.startPts = 0
        this.startClock = 0

        // 清理定时器
        if (this.scheduleTimerId !== null) {
            clearTimeout(this.scheduleTimerId)
            this.scheduleTimerId = null
        }

        if (this.ctx) {
            this.ctx.close().catch(() => {})
            this.ctx = null
            this.gainNode = null
        }
    }

    // ── 时间查询 ────────────────────────────────────────

    /** 基于 AudioContext 时钟实时推算当前**正在播放**的 PTS（ms）。
     *  注意：返回的是播放位置，不是调度位置。
     *  VideoScheduler 用此值做 A/V 同步。 */
    getCurrentPts(): number {
        if (!this.started || !this.ctx) return 0
        const elapsedMs = (this.ctx.currentTime - this.startClock) * 1000
        const realtimePts = this.startPts + elapsedMs
        // 用 currentPts 兜底防止时钟倒退，但不允许它超过实时位置太多
        return Math.max(realtimePts, Math.min(realtimePts, this.currentPts))
    }

    /** 获取已经调度到的最远 PTS（调度器内部使用，不用于 A/V 同步） */
    getScheduledPts(): number {
        return this.currentPts
    }

    /** 获取 AudioContext 当前时钟（秒） */
    getAudioClock(): number {
        return this.ctx?.currentTime ?? 0
    }

    // ── 播放调度 ────────────────────────────────────────

    /** 将解码帧加入播放队列 */
    async play(frame: AudioData, pts?: number): Promise<void> {
        const ctx = await this.ensureCtx()
        this.playCount++
        const dur = frame.duration / 1_000_000 // μs → 秒
        this.frameQueue.push({ frame, pts: pts ?? 0 })
        this.bufferedDuration += dur

        if (pts !== undefined && pts > 0 && this.firstPts < 0) {
            this.firstPts = pts
        }

        // 启动调度循环
        if (!this.scheduling && (this.started || this.bufferedDuration >= this.bufferTarget)) {
            this.scheduleLoop(ctx)
        }
    }

    private scheduleLoop(ctx: AudioContext): void {
        if (this.frameQueue.length === 0) {
            this.scheduling = false
            return
        }
        this.scheduling = true

        while (this.frameQueue.length > 0) {
            const { frame, pts } = this.frameQueue.shift()!
            const dur: number = frame.duration / 1_000_000
            this.bufferedDuration -= dur

            if (pts > 0) {
                this.currentPts = pts
            }

            // 时间同步
            const now = ctx.currentTime
            if (this.nextTime + 0.2 < now) {
                // 落后超过 200ms，跳到当前时间
                this.nextTime = now
            }
            if (this.nextTime < now) {
                this.nextTime = now
            }

            // 复制 AudioData 到 AudioBuffer
            const channels = frame.numberOfChannels
            const frameCount = frame.numberOfFrames
            const sampleRate = frame.sampleRate

            const buffer = ctx.createBuffer(channels, frameCount, sampleRate)
            for (let ch = 0; ch < channels; ch++) {
                const dest = buffer.getChannelData(ch)
                frame.copyTo(dest, { planeIndex: ch, format: 'f32-planar' })
            }

            const source = ctx.createBufferSource()
            source.buffer = buffer
            source.connect(this.gainNode!)

            if (!this.started) {
                this.started = true
                this.startPts = pts
                this.startClock = this.nextTime
            }

            source.start(this.nextTime)
            this.nextTime += dur

            // 提前调度够了，跳出循环，用定时器续上
            if (this.nextTime - now > this.scheduleAheadMax) {
                break
            }
        }

        this.scheduling = false

        // 还有帧待调度？用自适应间隔定时器续上
        if (this.frameQueue.length > 0) {
            this.scheduling = true
            const interval = Math.max(10, Math.min(200, this.bufferedDuration * 500))
            this.scheduleTimerId = setTimeout(() => {
                if (this.ctx) this.scheduleLoop(this.ctx)
            }, interval)
        }
    }

    // ── 音量控制 ────────────────────────────────────────

    get volume(): number {
        return this._volume
    }

    get muted(): boolean {
        return this._muted
    }

    setVolume(v: number): void {
        this._volume = Math.max(0, Math.min(1, v))
        if (this._volume > 0 && this._muted) {
            this._muted = false
        }
        if (!this._muted && this.gainNode) {
            this.gainNode.gain.value = this._volume
        }
    }

    mute(): void {
        if (this._muted) return
        this._preMuteVolume = this._volume
        this._muted = true
        if (this.gainNode) {
            this.gainNode.gain.value = 0
        }
    }

    unmute(): void {
        if (!this._muted) return
        this._muted = false
        this._volume = this._preMuteVolume
        if (this.gainNode) {
            this.gainNode.gain.value = this._volume
        }
    }

    toggleMute(): boolean {
        if (this._muted) {
            this.unmute()
        } else {
            this.mute()
        }
        return this._muted
    }

    // ── 生命周期 ────────────────────────────────────────

    async suspend(): Promise<void> {
        if (this.ctx && this.ctx.state === 'running') {
            await this.ctx.suspend()
        }
    }

    async resume(): Promise<void> {
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume()
        }
    }

    get suspended(): boolean {
        return this.ctx?.state === 'suspended'
    }
}
