// ── WebCodecs VideoDecoder 封装 ─────────────────────────
// 支持 H.264/AVC，带错误恢复和关键帧等待。

import { error as logError, warn as logWarn, info as logInfo } from '../../utility/logger'

export interface AvcDecoderConfig {
    codec: string           // 'avc1.XXYYZZ'
    description: Uint8Array // AVCDecoderConfigurationRecord 字节
    codedWidth?: number
    codedHeight?: number
}

export class AvcDecoder {
    private decoder: VideoDecoder | null = null
    private configured = false
    private _config: AvcDecoderConfig | null = null
    private _outputCallback: ((frame: VideoFrame) => void) | null = null
    private _errorCallback: ((error: Error) => void) | null = null
    private _errorCount = 0

    // ── 关键帧等待 ──────────────────────────────────
    private _waitingForKeyframe = true
    // 暂存的 delta 帧（等待关键帧期间缓存，关键帧到达后释放）
    private _pendingDeltaFrames: { data: Uint8Array; timestamp: number }[] = []
    private readonly MAX_PENDING_DELTAS = 30

    /** 输出帧回调 */
    set onFrame(cb: ((frame: VideoFrame) => void) | null) {
        this._outputCallback = cb
    }

    /** 不可恢复错误回调 */
    set onError(cb: ((error: Error) => void) | null) {
        this._errorCallback = cb
    }

    /** 配置解码器 */
    configure(config: AvcDecoderConfig): void {
        this._config = config
        this._waitingForKeyframe = true
        this._pendingDeltaFrames = []

        try {
            this.decoder = new VideoDecoder({
                output: (frame: VideoFrame) => {
                    this._outputCallback?.(frame)
                },
                error: (e: DOMException) => {
                    logError(`[AvcDecoder] 解码错误: ${e.message}`)
                    this._errorCount++
                    if (this._errorCount < 5 && this._config) {
                        this._attemptRecovery()
                    } else if (this._errorCount >= 5) {
                        this._errorCallback?.(new Error(`VideoDecoder 连续失败 ${this._errorCount} 次: ${e.message}`))
                    }
                },
            })

            const decoderConfig: VideoDecoderConfig = {
                codec: config.codec,
                description: config.description,
            }
            if (config.codedWidth && config.codedHeight) {
                decoderConfig.codedWidth = config.codedWidth
                decoderConfig.codedHeight = config.codedHeight
            }

            this.decoder.configure(decoderConfig)
            this.configured = true
            this._errorCount = 0
        } catch (e) {
            logError(`[AvcDecoder] 配置失败: ${e}`)
            this._errorCallback?.(new Error(`VideoDecoder 配置失败: ${e}`))
        }
    }

    /** 解码一帧 H.264 数据 */
    decode(data: Uint8Array, timestamp: number, isKey: boolean): void {
        if (!this.configured || !this.decoder) return
        if (this.decoder.state !== 'configured') return

        // ── 关键帧门控 ──────────────────────────────
        if (this._waitingForKeyframe) {
            if (isKey) {
                this._waitingForKeyframe = false
                logInfo(`[AvcDecoder] 收到关键帧 pts=${timestamp}ms, 开始输出视频`)
                // 关键帧到达：丢弃之前缓存的 delta（它们引用的是旧 GOP）
                this._pendingDeltaFrames = []
            } else {
                if (this._pendingDeltaFrames.length < this.MAX_PENDING_DELTAS) {
                    this._pendingDeltaFrames.push({ data: new Uint8Array(data), timestamp })
                }
                return
            }
        }

        this._submitChunk(data, timestamp, isKey)

        // ── 关键帧到达后，提交之前暂存的新 GOP delta 帧 ──
        if (isKey && this._pendingDeltaFrames.length > 0) {
            const pending = this._pendingDeltaFrames
            this._pendingDeltaFrames = []
            for (const d of pending) {
                this._submitChunk(d.data, d.timestamp, false)
            }
        }
    }

    private _submitChunk(data: Uint8Array, timestamp: number, isKey: boolean): void {
        if (!this.decoder || this.decoder.state !== 'configured') return

        try {
            const chunk = new EncodedVideoChunk({
                type: isKey ? 'key' : 'delta',
                timestamp: Math.round(timestamp * 1000), // ms → μs
                data,
            })
            this.decoder.decode(chunk)
        } catch (e) {
            logWarn(`[AvcDecoder] decode 提交失败: ${e}`)
        }
    }

    /** 刷新待处理帧 */
    async flush(): Promise<void> {
        if (!this.decoder || this.decoder.state !== 'configured') return
        try {
            await this.decoder.flush()
        } catch {
            // ignore
        }
    }

    /** 关闭解码器 */
    close(): void {
        if (this.decoder && this.decoder.state !== 'closed') {
            try {
                this.decoder.close()
            } catch {
                // ignore
            }
        }
        this.decoder = null
        this.configured = false
        this._waitingForKeyframe = true
        this._pendingDeltaFrames = []
    }

    /** 错误恢复 */
    private _attemptRecovery(): void {
        if (!this._config) return
        logWarn('[AvcDecoder] 尝试错误恢复，重新配置解码器...')
        try {
            this.close()
            setTimeout(() => {
                if (this._config) {
                    this.configure(this._config)
                }
            }, 50)
        } catch {
            // ignore
        }
    }
}
