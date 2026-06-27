/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

// WebCodecs API 类型（vue-tsc 环境兼容）
interface AudioDecoderInit {
  output: (frame: AudioData) => void
  error: (error: DOMException) => void
}

interface AudioDecoderConfig {
  codec: string
  sampleRate: number
  numberOfChannels: number
  description?: BufferSource
}

declare class AudioDecoder {
  constructor(init: AudioDecoderInit)
  readonly state: CodecState
  configure(config: AudioDecoderConfig): void
  decode(chunk: EncodedAudioChunk): void
  flush(): Promise<void>
  close(): void
}

interface EncodedAudioChunkInit {
  type: EncodedAudioChunkType
  timestamp: number
  data: BufferSource
}

declare class EncodedAudioChunk {
  constructor(init: EncodedAudioChunkInit)
}

declare class AudioData {
  readonly numberOfChannels: number
  readonly numberOfFrames: number
  readonly sampleRate: number
  readonly duration: number
  readonly timestamp: number
  copyTo(
    destination: AllowSharedBufferSource,
    options: { planeIndex: number; format: 'f32-planar' | 's16' | 'u8' },
  ): void
  close(): void
}

type CodecState = 'unconfigured' | 'configured' | 'closed'
type EncodedAudioChunkType = 'key' | 'delta'
type EncodedVideoChunkType = 'key' | 'delta'

// ── VideoDecoder (WebCodecs) ──────────────────────────

interface VideoDecoderInit {
  output: (frame: VideoFrame) => void
  error: (error: DOMException) => void
}

interface VideoDecoderConfig {
  codec: string
  description?: BufferSource
  codedWidth?: number
  codedHeight?: number
}

declare class VideoDecoder {
  constructor(init: VideoDecoderInit)
  readonly state: CodecState
  configure(config: VideoDecoderConfig): void
  decode(chunk: EncodedVideoChunk): void
  flush(): Promise<void>
  close(): void
}

// ── EncodedVideoChunk ─────────────────────────────────

interface EncodedVideoChunkInit {
  type: EncodedVideoChunkType
  timestamp: number
  duration?: number
  data: BufferSource
}

declare class EncodedVideoChunk {
  constructor(init: EncodedVideoChunkInit)
  readonly type: EncodedVideoChunkType
  readonly timestamp: number
  readonly duration: number | null
  readonly byteLength: number
}

// ── VideoFrame ────────────────────────────────────────

declare class VideoFrame {
  constructor(source: CanvasImageSource, init?: VideoFrameInit)
  readonly codedWidth: number
  readonly codedHeight: number
  readonly displayWidth: number
  readonly displayHeight: number
  readonly timestamp: number
  readonly duration: number | null
  readonly format: VideoPixelFormat | null
  close(): void
}

interface VideoFrameInit {
  timestamp?: number
  duration?: number
  displayWidth?: number
  displayHeight?: number
}

type VideoPixelFormat = 'I420' | 'I420A' | 'I422' | 'I444' | 'NV12' | 'RGBA' | 'RGBX' | 'BGRA' | 'BGRX'
