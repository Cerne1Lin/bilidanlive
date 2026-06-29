// ── WebCodecs AudioDecoder 封装 ────────────────────────
// 支持 AAC-LC (mp4a.40.2) 和 HE-AAC (mp4a.40.5)，带错误恢复。

import { error as logError, warn as logWarn } from "../../utility/logger";

export interface AacDecoderConfig {
    codec: string; // 'mp4a.40.2' 或 'mp4a.40.5'
    sampleRate: number;
    numberOfChannels: number;
    description: Uint8Array; // AudioSpecificConfig 字节
}

export class AacDecoder {
    private decoder: AudioDecoder | null = null;
    private configured = false;
    private _config: AacDecoderConfig | null = null;
    private _outputCallback: ((frame: AudioData) => void) | null = null;
    private _errorCallback: ((error: Error) => void) | null = null;
    private _pendingFlushResolve: (() => void) | null = null;
    private _errorCount = 0;

    /** 输出帧回调 */
    set onFrame(cb: ((frame: AudioData) => void) | null) {
        this._outputCallback = cb;
    }

    /** 不可恢复错误回调 */
    set onError(cb: ((error: Error) => void) | null) {
        this._errorCallback = cb;
    }

    /** 配置解码器 */
    configure(config: AacDecoderConfig): void {
        this._config = config;

        try {
            this.decoder = new AudioDecoder({
                output: (frame: AudioData) => {
                    this._outputCallback?.(frame);
                },
                error: (e: DOMException) => {
                    logError(`[AacDecoder] 解码错误: ${e.message}`);
                    this._errorCount++;
                    // 尝试错误恢复：短暂中断后重新配置
                    if (this._errorCount < 5 && this._config) {
                        this._attemptRecovery();
                    } else if (this._errorCount >= 5) {
                        this._errorCallback?.(
                            new Error(
                                `AudioDecoder 连续失败 ${this._errorCount} 次: ${e.message}`,
                            ),
                        );
                    }
                },
            });

            this.decoder.configure({
                codec: config.codec,
                sampleRate: config.sampleRate,
                numberOfChannels: config.numberOfChannels,
                description: config.description,
            });
            this.configured = true;
            this._errorCount = 0;
        } catch (e) {
            logError(`[AacDecoder] 配置失败: ${e}`);
            this._errorCallback?.(new Error(`AudioDecoder 配置失败: ${e}`));
        }
    }

    /** 解码一帧 AAC 数据 */
    decode(data: Uint8Array, timestamp: number): void {
        if (!this.configured || !this.decoder) return;
        if (this.decoder.state !== "configured") return;

        try {
            const chunk = new EncodedAudioChunk({
                type: "key",
                timestamp: Math.round(timestamp * 1000), // ms → μs
                data,
            });
            this.decoder.decode(chunk);
        } catch (e) {
            logWarn(`[AacDecoder] decode 提交失败: ${e}`);
        }
    }

    /** 刷新待处理帧 */
    async flush(): Promise<void> {
        if (!this.decoder || this.decoder.state !== "configured") return;
        return new Promise<void>((resolve) => {
            this._pendingFlushResolve = resolve;
            try {
                this.decoder!.flush();
                // flush() 返回 Promise，完成后 output 不再有新帧
                this.decoder!.flush()
                    .then(() => {
                        this._pendingFlushResolve?.();
                    })
                    .catch(() => {
                        this._pendingFlushResolve?.();
                    });
            } catch {
                resolve();
            }
        });
    }

    /** 关闭解码器 */
    close(): void {
        if (this.decoder && this.decoder.state !== "closed") {
            try {
                this.decoder.close();
            } catch {
                // ignore
            }
        }
        this.decoder = null;
        this.configured = false;
    }

    /** 错误恢复：关闭并重新配置 */
    private _attemptRecovery(): void {
        if (!this._config) return;
        logWarn("[AacDecoder] 尝试错误恢复，重新配置解码器...");
        try {
            this.close();
            // 延迟重建，避免立即触发相同错误
            setTimeout(() => {
                if (this._config) {
                    this.configure(this._config);
                }
            }, 50);
        } catch {
            // 如果恢复失败，交给 onError 处理
        }
    }
}
