// ── 完整 FLV 解复用器 ──────────────────────────────────
// 解析 FLV 容器：header + tags（script/audio/video）。
// 从 flv.js src/demux/flv-demuxer.js 移植，适配 WebCodecs 管线。

import { parseScriptData } from "./AmfParser";
import { parseSPS, type SpsInfo } from "./SpsParser";
import { MediaInfo } from "./MediaInfo";
import { warn as logWarn } from "../../utility/logger";

// ── 类型定义 ───────────────────────────────────────────

export interface AudioSample {
    unit: Uint8Array;
    length: number;
    dts: number;
    pts: number;
}

export interface NalUnit {
    type: number;
    data: Uint8Array;
}

export interface VideoSample {
    units: NalUnit[];
    rawData: Uint8Array; // 原始 AVCC 格式数据（带长度前缀的 NAL 单元），直传解码器
    length: number;
    isKeyframe: boolean;
    dts: number;
    cts: number;
    pts: number;
    fileposition?: number;
}

export interface AudioTrack {
    type: "audio";
    id: 2;
    sequenceNumber: number;
    samples: AudioSample[];
    length: number;
}

export interface VideoTrack {
    type: "video";
    id: 1;
    sequenceNumber: number;
    samples: VideoSample[];
    length: number;
}

export interface AudioMetadata {
    type: "audio";
    id: 2;
    timescale: number;
    duration: number;
    audioSampleRate: number;
    channelCount: number;
    codec: string;
    originalCodec: string;
    config: Uint8Array;
    refSampleDuration: number;
}

export interface VideoMetadata {
    type: "video";
    id: 1;
    timescale: number;
    duration: number;
    codecWidth: number;
    codecHeight: number;
    presentWidth: number;
    presentHeight: number;
    profile: string;
    level: string;
    bitDepth: number;
    chromaFormat: string;
    sarRatio: { width: number; height: number };
    frameRate: {
        fixed: boolean;
        fps: number;
        fps_num: number;
        fps_den: number;
    };
    refSampleDuration: number;
    codec: string;
    avcc: Uint8Array;
}

// ── 采样率表 ────────────────────────────────────────────

const MPEG_SAMPLING_RATES = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
    8000, 7350,
];

// ── 错误类型 ────────────────────────────────────────────

export const DemuxErrors = {
    OK: "OK",
    FORMAT_ERROR: "FormatError",
    CODEC_UNSUPPORTED: "CodecUnsupported",
} as const;

// ── 检测浏览器类型 ─────────────────────────────────────

function detectBrowser(): string {
    const ua = navigator.userAgent;
    if (/Firefox/i.test(ua)) return "Firefox";
    if (/Android/i.test(ua)) return "Android";
    if (/Chrome/i.test(ua)) return "Chrome";
    if (/Safari/i.test(ua)) return "Safari";
    return "Unknown";
}

const BROWSER = detectBrowser();

// ── FlvDemuxer 类 ──────────────────────────────────────

export class FlvDemuxer {
    // 缓冲区
    private _buffer = new Uint8Array(0);
    private _headerParsed = false;
    private _dataOffset = 0;
    private _tagPosition = 0;

    // 轨道模型
    private _audioTrack: AudioTrack = {
        type: "audio",
        id: 2,
        sequenceNumber: 0,
        samples: [],
        length: 0,
    };
    private _videoTrack: VideoTrack = {
        type: "video",
        id: 1,
        sequenceNumber: 0,
        samples: [],
        length: 0,
    };

    // 轨道元数据
    private _audioMetadata: AudioMetadata | null = null;
    private _videoMetadata: VideoMetadata | null = null;

    // 媒体信息
    private _mediaInfo = new MediaInfo();

    // 原始 onMetaData（AMF 解析结果）
    private _metadata: Record<string, unknown> | null = null;

    // 时间戳基准
    private _timestampBase = 0;

    // NAL 单元长度大小
    private _naluLengthSize = 4;

    // 覆盖标志
    private _hasAudioFlagOverrided = false;
    private _hasVideoFlagOverrided = false;

    // 元数据分发状态
    private _audioMetadataDispatched = false;
    private _videoMetadataDispatched = false;
    private _mediaInfoDispatched = false;

    // 参考帧率（SPS 不可用时的回退值）
    private _referenceFrameRate = {
        fixed: true,
        fps: 30,
        fps_num: 30,
        fps_den: 1,
    };

    // ── 回调 ────────────────────────────────────────────

    onMetaDataArrived: ((meta: Record<string, unknown>) => void) | null = null;
    onMediaInfo: ((mediaInfo: MediaInfo) => void) | null = null;
    onTrackMetadata:
        | ((
              type: "audio" | "video",
              meta: AudioMetadata | VideoMetadata,
          ) => void)
        | null = null;
    onDataAvailable:
        | ((audioTrack: AudioTrack, videoTrack: VideoTrack) => void)
        | null = null;
    onError: ((type: string, message: string) => void) | null = null;

    // ── 属性 ────────────────────────────────────────────

    get timestampBase(): number {
        return this._timestampBase;
    }
    set timestampBase(v: number) {
        this._timestampBase = v;
    }

    get mediaInfo(): MediaInfo {
        return this._mediaInfo;
    }

    get hasAudio(): boolean {
        return this._mediaInfo.hasAudio ?? false;
    }

    get hasVideo(): boolean {
        return this._mediaInfo.hasVideo ?? false;
    }

    // ── 公开方法 ────────────────────────────────────────

    /** 检测是否为有效 FLV 数据 */
    static probe(data: Uint8Array): {
        match: boolean;
        consumed: number;
        dataOffset: number;
        hasAudioTrack: boolean;
        hasVideoTrack: boolean;
    } | null {
        if (data.length < 9) return null;

        if (
            data[0] !== 0x46 ||
            data[1] !== 0x4c ||
            data[2] !== 0x56 ||
            data[3] !== 0x01
        ) {
            return null;
        }

        const hasAudio = (data[4] & 4) >>> 2 !== 0;
        const hasVideo = (data[4] & 1) !== 0;
        const offset =
            (data[5] << 24) | (data[6] << 16) | (data[7] << 8) | data[8];

        if (offset < 9) return null;

        return {
            match: true,
            consumed: 9,
            dataOffset: offset,
            hasAudioTrack: hasAudio,
            hasVideoTrack: hasVideo,
        };
    }

    reset(): void {
        this._buffer = new Uint8Array(0);
        this._headerParsed = false;
        this._tagPosition = 0;
        this._audioTrack = {
            type: "audio",
            id: 2,
            sequenceNumber: 0,
            samples: [],
            length: 0,
        };
        this._videoTrack = {
            type: "video",
            id: 1,
            sequenceNumber: 0,
            samples: [],
            length: 0,
        };
        this._audioMetadata = null;
        this._videoMetadata = null;
        this._metadata = null;
        this._mediaInfo = new MediaInfo();
        this._audioMetadataDispatched = false;
        this._videoMetadataDispatched = false;
        this._mediaInfoDispatched = false;
    }

    destroy(): void {
        this.reset();
        this._buffer = new Uint8Array(0);
    }

    /** 喂入原始 FLV 字节，触发回调 */
    feed(chunk: Uint8Array): void {
        // 合并缓冲区
        const next = new Uint8Array(this._buffer.length + chunk.length);
        next.set(this._buffer);
        next.set(chunk, this._buffer.length);
        this._buffer = next;

        // 解析 FLV header（仅首次）
        if (!this._headerParsed) {
            if (this._buffer.length < 9) return;
            const probe = FlvDemuxer.probe(this._buffer);
            if (!probe) {
                this._onError(DemuxErrors.FORMAT_ERROR, "无效的 FLV 签名");
                return;
            }
            this._dataOffset = probe.dataOffset;
            this._mediaInfo.hasAudio = probe.hasAudioTrack;
            this._mediaInfo.hasVideo = probe.hasVideoTrack;
            this._headerParsed = true;
            this._tagPosition = this._dataOffset;
            // 跳过 FLV header（dataOffset 字节）
            this._buffer = this._buffer.subarray(this._dataOffset);
        }

        // 主解析循环
        // Buffer 布局: [PreviousTagSize:4] [TagHeader:11] [Data:dataSize] [NextPreviousTagSize:4]
        const PREV_TAG_SIZE_BYTES = 4;
        const TAG_HEADER_BYTES = 11;
        while (this._buffer.length >= PREV_TAG_SIZE_BYTES + TAG_HEADER_BYTES) {
            // 验证 PreviousTagSize（buffer[0..3]）
            const prevTagSize =
                (this._buffer[0] << 24) |
                (this._buffer[1] << 16) |
                (this._buffer[2] << 8) |
                this._buffer[3];
            // 首个 PreviousTagSize 必须为 0
            if (this._tagPosition === this._dataOffset && prevTagSize !== 0) {
                this._onError(
                    DemuxErrors.FORMAT_ERROR,
                    `首个 PreviousTagSize 应为 0，实际为 ${prevTagSize}`,
                );
            }

            // 读取 tag header（buffer[4..14]）
            const tagType = this._buffer[4];
            const dataSize =
                ((this._buffer[5] << 16) |
                    (this._buffer[6] << 8) |
                    this._buffer[7]) >>>
                0;
            // FLV 时间戳：tag header bytes 4-6 = 低 24 位（大端序），byte 7 = 高 8 位
            // buffer: [4]=type, [5..7]=dataSize, [8..10]=timestamp(大端24位), [11]=timestampExtended
            const timestamp =
                (this._buffer[10] | // LSB of lower 24 bits
                    (this._buffer[9] << 8) | // middle
                    (this._buffer[8] << 16) | // MSB of lower 24 bits
                    (this._buffer[11] << 24)) >>>
                0; // extended upper 8 bits
            // streamId: buffer[12..14] (ignored)

            // data 起始于 buffer[15]（4 + 11 = 15），next PreviousTagSize 起始于 buffer[15 + dataSize]
            const tagDataOffset = PREV_TAG_SIZE_BYTES + TAG_HEADER_BYTES; // = 15
            const totalNeeded = tagDataOffset + dataSize + PREV_TAG_SIZE_BYTES;
            if (this._buffer.length < totalNeeded) break;

            // 提取 tag 数据
            const tagData = this._buffer.subarray(
                tagDataOffset,
                tagDataOffset + dataSize,
            );

            // 分发解析
            switch (tagType) {
                case 8:
                    this._parseAudioTag(tagData, timestamp);
                    break;
                case 9:
                    this._parseVideoTag(
                        tagData,
                        timestamp,
                        this._tagPosition + PREV_TAG_SIZE_BYTES,
                    );
                    break;
                case 18:
                    this._parseScriptTag(tagData);
                    break;
                // 其他类型忽略
            }

            // 验证下一个 PreviousTagSize（在 tagDataOffset + dataSize 处）
            const nextPrevOffset = tagDataOffset + dataSize;
            const nextPrevTagSize =
                (this._buffer[nextPrevOffset] << 24) |
                (this._buffer[nextPrevOffset + 1] << 16) |
                (this._buffer[nextPrevOffset + 2] << 8) |
                this._buffer[nextPrevOffset + 3];
            const expectedPrevTagSize = TAG_HEADER_BYTES + dataSize; // = 11 + dataSize
            if (nextPrevTagSize !== expectedPrevTagSize) {
                logWarn(
                    `[FlvDemuxer] PreviousTagSize 不匹配: 期望=${expectedPrevTagSize}, 实际=${nextPrevTagSize}`,
                );
            }

            // 前进：只跳过 PreviousTagSize(4) + TagHeader(11) + Data(dataSize)
            // 下一个 PreviousTagSize 留在缓冲区头部供下次迭代读取
            const tagTotalSize = tagDataOffset + dataSize;
            this._buffer = this._buffer.subarray(tagTotalSize);
            this._tagPosition += tagTotalSize;
        }

        // 分发累积的样本
        this._dispatchSamples();
    }

    // ── Script Tag 解析 ─────────────────────────────────

    private _parseScriptTag(data: Uint8Array): void {
        const scriptData = parseScriptData(
            data.buffer,
            data.byteOffset,
            data.byteLength,
        );
        const onMetaData = scriptData["onMetaData"] as
            | Record<string, unknown>
            | undefined;

        if (onMetaData) {
            this._metadata = { ...onMetaData };

            // 提取 to MediaInfo
            if (typeof onMetaData["duration"] === "number") {
                this._mediaInfo.duration = Math.floor(
                    onMetaData["duration"] * 1000,
                );
            }
            if (typeof onMetaData["width"] === "number") {
                this._mediaInfo.width = onMetaData["width"];
            }
            if (typeof onMetaData["height"] === "number") {
                this._mediaInfo.height = onMetaData["height"];
            }
            if (typeof onMetaData["framerate"] === "number") {
                this._mediaInfo.fps = onMetaData["framerate"];
            }
            if (typeof onMetaData["audiocodecid"] === "number") {
                this._mediaInfo.audioCodec = String(onMetaData["audiocodecid"]);
            }
            if (typeof onMetaData["videocodecid"] === "number") {
                this._mediaInfo.videoCodec = String(onMetaData["videocodecid"]);
            }
            if (typeof onMetaData["audiodatarate"] === "number") {
                this._mediaInfo.audioDataRate = onMetaData["audiodatarate"];
            }
            if (typeof onMetaData["videodatarate"] === "number") {
                this._mediaInfo.videoDataRate = onMetaData["videodatarate"];
            }

            // 关键帧索引
            if (
                onMetaData["keyframes"] &&
                typeof onMetaData["keyframes"] === "object"
            ) {
                const kf = onMetaData["keyframes"] as Record<string, unknown>;
                if (
                    Array.isArray(kf["times"]) &&
                    Array.isArray(kf["filepositions"])
                ) {
                    const times = kf["times"] as number[];
                    const positions = kf["filepositions"] as number[];
                    // 跳过第一项（是 sequence header 的偏移量）
                    this._mediaInfo.keyframesIndex = {
                        times: times.slice(1),
                        filepositions: positions.slice(1),
                    };
                    this._mediaInfo.hasKeyframesIndex = true;
                }
            } else {
                this._mediaInfo.hasKeyframesIndex = false;
            }

            // 覆盖 hasAudio / hasVideo
            if (typeof onMetaData["hasAudio"] === "boolean") {
                this._hasAudioFlagOverrided = true;
                this._mediaInfo.hasAudio = onMetaData["hasAudio"];
            }
            if (typeof onMetaData["hasVideo"] === "boolean") {
                this._hasVideoFlagOverrided = true;
                this._mediaInfo.hasVideo = onMetaData["hasVideo"];
            }

            // 设置 mimeType
            if (this._mediaInfo.mimeType == null) {
                this._mediaInfo.mimeType = "video/x-flv";
            }

            // 回调
            this._mediaInfo.metadata = this._metadata;
            this.onMetaDataArrived?.(this._metadata);

            if (this._mediaInfo.isComplete() && !this._mediaInfoDispatched) {
                this._mediaInfoDispatched = true;
                this.onMediaInfo?.(this._mediaInfo);
            }
        }
    }

    // ── Audio Tag 解析 ──────────────────────────────────

    private _parseAudioTag(data: Uint8Array, timestamp: number): void {
        if (data.length < 2) return;

        const soundFormat = (data[0] & 0xf0) >> 4;
        // const soundRate = (data[0] & 0x0c) >> 2
        // const soundType = data[0] & 0x01

        if (soundFormat !== 10) {
            // 只处理 AAC (format 10)
            return;
        }

        const aacPacketType = data[1];

        if (aacPacketType === 0) {
            // AudioSpecificConfig
            const ascData = data.subarray(2);
            this._parseAACAudioSpecificConfig(ascData);
        } else if (aacPacketType === 1) {
            // Raw AAC frame
            const aacData = data.subarray(2);
            const ts = timestamp + this._timestampBase;
            const sample: AudioSample = {
                unit: aacData,
                length: aacData.length,
                dts: ts,
                pts: ts,
            };
            this._audioTrack.samples.push(sample);
            this._audioTrack.length += aacData.length;
        }
    }

    private _parseAACAudioSpecificConfig(array: Uint8Array): void {
        if (array.length < 2) {
            this._onError(
                DemuxErrors.FORMAT_ERROR,
                "AudioSpecificConfig 数据不足",
            );
            return;
        }

        let audioObjectType = array[0] >>> 3;
        const originalAudioObjectType = audioObjectType;
        let samplingIndex = ((array[0] & 0x07) << 1) | (array[1] >>> 7);
        if (samplingIndex >= MPEG_SAMPLING_RATES.length) {
            this._onError(
                DemuxErrors.FORMAT_ERROR,
                `无效的 AAC 采样率索引: ${samplingIndex}`,
            );
            return;
        }
        const samplingRate = MPEG_SAMPLING_RATES[samplingIndex];
        let channelConfig = (array[1] & 0x78) >>> 3;

        // HE-AAC 扩展
        let extensionSamplingIndex = samplingIndex;
        if (audioObjectType === 5) {
            // HE-AAC: 读取扩展信息
            if (array.length >= 4) {
                extensionSamplingIndex =
                    ((array[1] & 0x07) << 1) | (array[2] >>> 7);
                // audioExtensionObjectType = (array[2] & 0x7C) >>> 2
            }
        }

        // ── 浏览器特定变通 ──────────────────────────────
        let config: Uint8Array;

        if (BROWSER === "Firefox") {
            // Firefox: 低频用 HE-AAC，否则用 LC-AAC
            if (samplingIndex >= 6) {
                audioObjectType = 5;
                config = new Uint8Array(4);
                extensionSamplingIndex = samplingIndex - 3;
            } else {
                audioObjectType = 2;
                config = new Uint8Array(2);
            }
        } else if (BROWSER === "Android") {
            // Android: 统一用 LC-AAC
            audioObjectType = 2;
            config = new Uint8Array(2);
        } else {
            // Chrome / Safari: 优先 HE-AAC
            if (samplingIndex >= 6 && channelConfig !== 1) {
                audioObjectType = 5;
                config = new Uint8Array(4);
                extensionSamplingIndex = samplingIndex - 3;
            } else if (channelConfig === 1) {
                // 单声道用 LC-AAC
                audioObjectType = 2;
                config = new Uint8Array(2);
            } else {
                audioObjectType = 5;
                config = new Uint8Array(4);
                extensionSamplingIndex = samplingIndex;
            }
        }

        // 填充 config 字节
        config[0] = (audioObjectType << 3) | ((samplingIndex & 0x0e) >>> 1);
        config[1] =
            ((samplingIndex & 0x01) << 7) | ((channelConfig & 0x0f) << 3);
        if (audioObjectType === 5) {
            // HE-AAC SBR
            config[1] |= (extensionSamplingIndex & 0x0e) >>> 1;
            config[2] = ((extensionSamplingIndex & 0x01) << 7) | (2 << 2); // extended object type = 2 (LC)
            config[3] = 0;
        }

        const codec = "mp4a.40." + audioObjectType;
        const originalCodec = "mp4a.40." + originalAudioObjectType;

        // 构建音频元数据
        const refSampleDuration = (1024 * 1000) / samplingRate;
        this._audioMetadata = {
            type: "audio",
            id: 2,
            timescale: 1000,
            duration: 0,
            audioSampleRate: samplingRate,
            channelCount: channelConfig,
            codec,
            originalCodec,
            config,
            refSampleDuration,
        };

        // 更新 MediaInfo
        this._mediaInfo.audioCodec = codec;
        this._mediaInfo.audioSampleRate = samplingRate;
        this._mediaInfo.audioChannelCount = channelConfig;

        // 回调
        this._audioMetadataDispatched = true;
        this.onTrackMetadata?.("audio", this._audioMetadata);

        if (this._mediaInfo.isComplete() && !this._mediaInfoDispatched) {
            this._mediaInfoDispatched = true;
            this.onMediaInfo?.(this._mediaInfo);
        }
    }

    // ── Video Tag 解析 ──────────────────────────────────

    private _parseVideoTag(
        data: Uint8Array,
        timestamp: number,
        tagPosition: number,
    ): void {
        if (data.length < 5) return;

        const frameType = (data[0] & 0xf0) >> 4;
        const codecId = data[0] & 0x0f;

        if (codecId !== 7) {
            // 只处理 AVC/H.264
            return;
        }

        const avcPacketType = data[1];
        // 24-bit Composition Time (有符号)
        const ctsUnsigned = ((data[2] << 16) | (data[3] << 8) | data[4]) >>> 0;
        const cts = (ctsUnsigned << 8) >> 8; // sign-extend 24-bit to 32-bit
        const avcData = data.subarray(5);

        if (avcPacketType === 0) {
            // AVCDecoderConfigurationRecord
            this._parseAVCDecoderConfigurationRecord(avcData);
        } else if (avcPacketType === 1) {
            // NAL unit data
            this._parseAVCVideoData(
                avcData,
                frameType,
                timestamp,
                cts,
                tagPosition,
            );
        }
        // packetType === 2: AVC end of sequence, ignore
    }

    private _parseAVCDecoderConfigurationRecord(data: Uint8Array): void {
        if (data.length < 7) {
            this._onError(
                DemuxErrors.FORMAT_ERROR,
                "AVCDecoderConfigurationRecord 数据不足",
            );
            return;
        }

        const version = data[0];
        if (version !== 1) {
            this._onError(
                DemuxErrors.FORMAT_ERROR,
                `不支持的 AVCC 版本: ${version}`,
            );
            return;
        }

        const avcProfile = data[1];
        const profileCompatibility = data[2];
        const avcLevel = data[3];

        if (avcProfile === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, "AVCC profile 为 0");
            return;
        }

        // NAL 单元长度大小
        this._naluLengthSize = (data[4] & 0x03) + 1;
        if (this._naluLengthSize !== 3 && this._naluLengthSize !== 4) {
            this._onError(
                DemuxErrors.FORMAT_ERROR,
                `无效的 NALU 长度大小: ${this._naluLengthSize}`,
            );
            return;
        }

        // 解析 SPS
        let spsCount = data[5] & 0x1f;
        if (spsCount === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, "AVCC 中没有 SPS");
            return;
        }
        if (spsCount > 1) {
            // 多个 SPS，仅使用第一个
        }

        let offset = 6;
        let spsInfo: SpsInfo | null = null;

        for (let i = 0; i < spsCount; i++) {
            if (offset + 2 > data.length) break;
            const spsLength = (data[offset] << 8) | data[offset + 1];
            offset += 2;
            if (offset + spsLength > data.length) break;
            const spsData = data.subarray(offset, offset + spsLength);
            offset += spsLength;

            // 只解析第一个 SPS
            if (i === 0) {
                spsInfo = parseSPS(spsData);
            }
        }

        // 跳过 PPS
        if (offset < data.length) {
            const ppsCount = data[offset];
            offset++;
            for (let i = 0; i < ppsCount; i++) {
                if (offset + 2 > data.length) break;
                const ppsLength = (data[offset] << 8) | data[offset + 1];
                offset += 2 + ppsLength;
            }
        }

        // 构建 codec 字符串
        const hex = (b: number) => b.toString(16).padStart(2, "0");
        const codec = `avc1.${hex(avcProfile)}${hex(profileCompatibility)}${hex(avcLevel)}`;

        // 存储完整 AVCC
        const avcc = new Uint8Array(data);

        // 使用 SPS 解析结果（如果可用），否则用 onMetaData
        let codecWidth =
            spsInfo?.codec_size.width ?? this._mediaInfo.width ?? 0;
        let codecHeight =
            spsInfo?.codec_size.height ?? this._mediaInfo.height ?? 0;
        const presentWidth = spsInfo?.present_size.width ?? codecWidth;
        const presentHeight = spsInfo?.present_size.height ?? codecHeight;
        const profileString = spsInfo?.profile_string ?? "Unknown";
        const levelString = spsInfo?.level_string ?? "0.0";
        const bitDepth = spsInfo?.bit_depth ?? 8;
        const chromaFormat = spsInfo?.chroma_format_string ?? "4:2:0";
        const sarWidth = spsInfo?.sar_ratio.width ?? 1;
        const sarHeight = spsInfo?.sar_ratio.height ?? 1;
        const refFrames = spsInfo?.ref_frames ?? 1;

        // 帧率：优先 SPS 的 timing_info，其次 onMetaData，最后默认
        let frameRate = this._referenceFrameRate;
        if (spsInfo && spsInfo.frame_rate.fps > 0) {
            frameRate = spsInfo.frame_rate;
        } else if (this._mediaInfo.fps != null && this._mediaInfo.fps > 0) {
            frameRate = {
                fixed: false,
                fps: this._mediaInfo.fps,
                fps_num: Math.round(this._mediaInfo.fps * 1000),
                fps_den: 1000,
            };
        }

        // 构建视频元数据
        this._videoMetadata = {
            type: "video",
            id: 1,
            timescale: 1000,
            duration: 0,
            codecWidth,
            codecHeight,
            presentWidth,
            presentHeight,
            profile: profileString,
            level: levelString,
            bitDepth,
            chromaFormat,
            sarRatio: { width: sarWidth, height: sarHeight },
            frameRate,
            refSampleDuration: frameRate.fps > 0 ? 1000 / frameRate.fps : 33,
            codec,
            avcc,
        };

        // 更新 MediaInfo
        this._mediaInfo.videoCodec = codec;
        if (this._mediaInfo.width == null) this._mediaInfo.width = codecWidth;
        if (this._mediaInfo.height == null)
            this._mediaInfo.height = codecHeight;
        if (this._mediaInfo.fps == null || this._mediaInfo.fps === 0) {
            this._mediaInfo.fps = frameRate.fps;
        }
        this._mediaInfo.profile = profileString;
        this._mediaInfo.level = levelString;
        this._mediaInfo.refFrames = refFrames;
        this._mediaInfo.chromaFormat = chromaFormat;

        // 回调
        this._videoMetadataDispatched = true;
        this.onTrackMetadata?.("video", this._videoMetadata);

        if (this._mediaInfo.isComplete() && !this._mediaInfoDispatched) {
            this._mediaInfoDispatched = true;
            this.onMediaInfo?.(this._mediaInfo);
        }
    }

    private _parseAVCVideoData(
        data: Uint8Array,
        frameType: number,
        tagTimestamp: number,
        cts: number,
        tagPosition: number,
    ): void {
        const ts = tagTimestamp + this._timestampBase;
        const dts = ts;
        const pts = ts + cts;
        const isKeyframe = frameType === 1;

        // 解析 NAL 单元
        const units: NalUnit[] = [];
        let offset = 0;

        while (offset + this._naluLengthSize <= data.length) {
            let naluLength = 0;
            if (this._naluLengthSize === 4) {
                naluLength =
                    (data[offset] << 24) |
                    (data[offset + 1] << 16) |
                    (data[offset + 2] << 8) |
                    data[offset + 3];
            } else {
                // naluLengthSize === 3
                naluLength =
                    (data[offset] << 16) |
                    (data[offset + 1] << 8) |
                    data[offset + 2];
            }
            offset += this._naluLengthSize;

            if (offset + naluLength > data.length) break;

            const naluData = data.subarray(offset, offset + naluLength);
            const naluType = naluData.length > 0 ? naluData[0] & 0x1f : 0;

            units.push({ type: naluType, data: naluData });
            offset += naluLength;
        }

        if (units.length === 0) return;

        const sample: VideoSample = {
            units,
            rawData: data, // 原始 AVCC 格式数据，直传解码器
            length: data.length,
            isKeyframe,
            dts,
            cts,
            pts,
        };
        if (isKeyframe) {
            sample.fileposition = tagPosition;
        }

        this._videoTrack.samples.push(sample);
        this._videoTrack.length += data.length;
    }

    // ── 样本分发 ────────────────────────────────────────

    private _dispatchSamples(): void {
        const hasData =
            this._audioTrack.samples.length > 0 ||
            this._videoTrack.samples.length > 0;

        const metadataReady = this._isInitialMetadataDispatched();

        if (metadataReady && hasData) {
            this.onDataAvailable?.(this._audioTrack, this._videoTrack);

            // 清空样本
            this._audioTrack.samples = [];
            this._audioTrack.length = 0;
            this._videoTrack.samples = [];
            this._videoTrack.length = 0;
        }
    }

    private _isInitialMetadataDispatched(): boolean {
        // 只要对应轨道的元数据已分发即可（或有 flag 覆盖说明没有该轨道）
        const audioOk =
            !this._mediaInfo.hasAudio ||
            this._audioMetadataDispatched ||
            this._hasAudioFlagOverrided;
        const videoOk =
            !this._mediaInfo.hasVideo ||
            this._videoMetadataDispatched ||
            this._hasVideoFlagOverrided;
        return audioOk && videoOk;
    }

    // ── 内部工具 ────────────────────────────────────────

    private _onError(type: string, message: string): void {
        logWarn(`[FlvDemuxer] ${message}`);
        this.onError?.(type, message);
    }
}
