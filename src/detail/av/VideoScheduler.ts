// ── 视频帧渲染调度器 ──────────────────────────────────
// rAF 驱动。核心策略：
//   1. 维持一个短视频缓冲（3-6 帧）以平滑解码突发
//   2. 按帧 PTS 时间渲染（不是尽快渲染）
//   3. 每 rAF tick 最多渲染一帧
//   4. 缓冲超过上限时放行一帧防止堆积

/** rAF 空闲多久后停止循环 */
const IDLE_TIMEOUT_MS = 1000
/** 帧落后时钟超过此值则丢弃 */
const MAX_BEHIND_MS = 300
/** 缓冲超过此帧数时放行超前帧，防止堆积 */
const TARGET_QUEUE_MAX = 6

export class VideoScheduler {
    private frameQueue: { frame: VideoFrame; pts: number }[] = []
    private scheduling = false
    private rafId: ReturnType<typeof requestAnimationFrame> | null = null
    private idleSince = 0

    private getAudioPts: (() => number) | null = null
    private renderCallback: ((frame: VideoFrame) => void) | null = null

    // 独立视频时钟
    private videoStartPts = -1
    private videoStartWallMs = -1
    private lastRenderPts = -1

    private lastRenderWallMs = -1      // 上一帧渲染的 wall clock（用于限制渲染速率）

    setRenderCallback(cb: (frame: VideoFrame) => void): void { this.renderCallback = cb }

    setAudioTiming(getPts: () => number, _getClock: () => number): void {
        this.getAudioPts = getPts
    }

    play(frame: VideoFrame, pts: number): void {
        this.frameQueue.push({ frame, pts })
        if (!this.scheduling) this.startRafLoop()
    }

    reset(): void {
        this.stopRafLoop()
        for (const { frame } of this.frameQueue) frame.close()
        this.frameQueue = []
        this.scheduling = false
        this.idleSince = 0
        this.videoStartPts = -1
        this.videoStartWallMs = -1
        this.lastRenderPts = -1
        this.lastRenderWallMs = -1
    }

    // ── 时钟 ────────────────────────────────────────

    private getClockMs(): number {
        // 优先音频播放位置
        const audioPts = this.getAudioPts?.()
        if (audioPts && audioPts > 0) return audioPts

        // 独立视频时钟
        if (this.videoStartWallMs > 0) {
            return this.videoStartPts + (performance.now() - this.videoStartWallMs)
        }

        // 用队首帧建立时钟
        if (this.frameQueue.length > 0) {
            this.videoStartPts = this.frameQueue[0].pts
            this.videoStartWallMs = performance.now()
            return this.videoStartPts
        }
        return 0
    }

    // ── rAF 管理 ────────────────────────────────────

    private startRafLoop(): void {
        if (this.scheduling) return
        this.scheduling = true
        this.scheduleLoop()
    }
    private stopRafLoop(): void {
        if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
        this.scheduling = false
    }
    private scheduleLoop(): void {
        this.rafId = requestAnimationFrame(() => {
            this.renderNextFrame()
            if (this.scheduling) this.scheduleLoop()
        })
    }

    // ── 渲染决策 ────────────────────────────────────

    private renderNextFrame(): void {
        if (this.frameQueue.length === 0) {
            if (this.idleSince === 0) { this.idleSince = performance.now() }
            else if (performance.now() - this.idleSince > IDLE_TIMEOUT_MS) { this.stopRafLoop() }
            return
        }
        this.idleSince = 0

        const nowMs = this.getClockMs()
        if (nowMs <= 0) return

        const queueLen = this.frameQueue.length

        // ── 丢弃严重落后帧 ──
        while (
            queueLen > 1 &&
            this.frameQueue.length > 1 &&
            this.frameQueue[1].pts < nowMs - MAX_BEHIND_MS
        ) {
            this.frameQueue.shift()!.frame.close()
        }
        if (this.frameQueue.length === 0) return

        // ── 帧间隔估算 ──
        const frameInterval = this.lastRenderPts > 0
            ? Math.max(16, Math.min(50, this.frameQueue[0].pts - this.lastRenderPts))
            : 33

        const firstPts = this.frameQueue[0].pts
        const ahead = firstPts - nowMs

        // ── 决策是否渲染 ──
        let shouldRender = false

        if (ahead <= frameInterval * 0.5) {
            // 帧已到展示时间（或略微提前 < 半帧）
            shouldRender = true
        } else if (queueLen > TARGET_QUEUE_MAX) {
            // 缓冲堆积超过上限 → 消耗一帧减压
            shouldRender = true
        }
        // 否则帧太超前且缓冲足够 → 等待（不渲染）

        if (shouldRender) {
            // 帧超前时限制渲染速率不超过源帧率（避免 60fps 渲染 30fps 内容）
            if (ahead > 0 && this.lastRenderWallMs > 0) {
                const minInterval = frameInterval * 0.85
                if (performance.now() - this.lastRenderWallMs < minInterval) {
                    return  // 跳过本 tick，等墙钟追上
                }
            }

            this.lastRenderPts = firstPts
            this.lastRenderWallMs = performance.now()
            this.renderCallback?.(this.frameQueue.shift()!.frame)
        }
    }
}
