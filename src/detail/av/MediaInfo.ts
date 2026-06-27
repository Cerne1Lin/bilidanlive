// ── 媒体信息数据模型 ────────────────────────────────────
// 从 flv.js src/core/media-info.js 移植

export interface KeyframeIndex {
    times: number[]          // 关键帧 PTS（秒）
    filepositions: number[]  // 关键帧文件偏移量
}

export interface MediaInfoData {
    mimeType: string | null
    duration: number | null          // ms
    hasAudio: boolean | null
    hasVideo: boolean | null
    audioCodec: string | null
    videoCodec: string | null
    audioDataRate: number | null     // kbps
    videoDataRate: number | null     // kbps
    audioSampleRate: number | null   // Hz
    audioChannelCount: number | null
    width: number | null             // coded width
    height: number | null            // coded height
    fps: number | null
    profile: string | null           // e.g. 'Baseline', 'Main', 'High'
    level: string | null             // e.g. '3.1'
    refFrames: number | null
    chromaFormat: string | null      // e.g. '4:2:0'
    sarNum: number | null
    sarDen: number | null
    metadata: Record<string, unknown> | null  // raw onMetaData
    keyframesIndex: KeyframeIndex | null
    hasKeyframesIndex: boolean | null
}

export class MediaInfo implements MediaInfoData {
    mimeType: string | null = null
    duration: number | null = null
    hasAudio: boolean | null = null
    hasVideo: boolean | null = null
    audioCodec: string | null = null
    videoCodec: string | null = null
    audioDataRate: number | null = null
    videoDataRate: number | null = null
    audioSampleRate: number | null = null
    audioChannelCount: number | null = null
    width: number | null = null
    height: number | null = null
    fps: number | null = null
    profile: string | null = null
    level: string | null = null
    refFrames: number | null = null
    chromaFormat: string | null = null
    sarNum: number | null = null
    sarDen: number | null = null
    metadata: Record<string, unknown> | null = null
    keyframesIndex: KeyframeIndex | null = null
    hasKeyframesIndex: boolean | null = null

    /** 检查所有媒体信息是否已就绪 */
    isComplete(): boolean {
        const audioComplete =
            this.hasAudio === false ||
            (this.hasAudio === true &&
                this.audioCodec != null &&
                this.audioSampleRate != null &&
                this.audioChannelCount != null)

        const videoComplete =
            this.hasVideo === false ||
            (this.hasVideo === true &&
                this.videoCodec != null &&
                this.width != null &&
                this.height != null &&
                this.fps != null &&
                this.profile != null &&
                this.level != null &&
                this.refFrames != null &&
                this.chromaFormat != null)

        const metaDone =
            this.mimeType != null &&
            this.duration != null &&
            this.metadata != null &&
            this.hasKeyframesIndex != null

        return audioComplete && videoComplete && metaDone
    }

    /** 是否支持 seek（有关键帧索引） */
    isSeekable(): boolean {
        return this.hasKeyframesIndex === true
    }

    /** 根据目标时间（ms）查找最近的关键帧索引 */
    getNearestKeyframe(ms: number): { index: number; ms: number; fileposition: number } | null {
        if (!this.keyframesIndex || this.keyframesIndex.times.length === 0) {
            return null
        }
        const times = this.keyframesIndex.times
        // 二分查找最近的关键帧
        let lo = 0
        let hi = times.length - 1
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1
            const midTime = times[mid] * 1000
            if (midTime < ms) {
                lo = mid + 1
            } else if (midTime > ms) {
                hi = mid - 1
            } else {
                return {
                    index: mid,
                    ms: midTime,
                    fileposition: this.keyframesIndex.filepositions[mid],
                }
            }
        }
        // hi 是最后一个 <= ms 的位置
        const idx = Math.max(0, hi)
        return {
            index: idx,
            ms: times[idx] * 1000,
            fileposition: this.keyframesIndex.filepositions[idx],
        }
    }
}
