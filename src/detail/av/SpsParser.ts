// ── H.264 SPS 解析器 ───────────────────────────────────
// 从 AVCDecoderConfigurationRecord 中的 SPS 提取编解码参数。
// 从 flv.js src/demux/sps-parser.js 移植。

import { ExpGolomb } from './ExpGolomb'

// ── 类型定义 ───────────────────────────────────────────

export interface SpsInfo {
    profile_string: string
    level_string: string
    bit_depth: number
    ref_frames: number
    chroma_format: number        // 420, 422, 444
    chroma_format_string: string // '4:2:0', '4:2:2', '4:4:4'
    frame_rate: {
        fixed: boolean
        fps: number
        fps_den: number
        fps_num: number
    }
    sar_ratio: {
        width: number
        height: number
    }
    codec_size: {
        width: number
        height: number
    }
    present_size: {
        width: number
        height: number
    }
}

// ── SAR 查找表 ─────────────────────────────────────────

const SAR_W_TABLE = [1, 12, 10, 16, 40, 24, 20, 32, 80, 18, 15, 64, 160, 4, 3, 2]
const SAR_H_TABLE = [1, 11, 11, 11, 33, 11, 11, 11, 33, 11, 11, 33, 99, 3, 2, 1]

// ── Profile 映射 ───────────────────────────────────────

function getProfileString(profileIdc: number): string {
    switch (profileIdc) {
        case 66:  return 'Baseline'
        case 77:  return 'Main'
        case 88:  return 'Extended'
        case 100: return 'High'
        case 110: return 'High10'
        case 122: return 'High422'
        case 244: return 'High444'
        default:  return 'Unknown'
    }
}

// ── EBSP → RBSP ────────────────────────────────────────

/** 移除防竞争字节（emulation prevention bytes），将 EBSP 转换为 RBSP */
function ebsp2rbsp(uint8array: Uint8Array): Uint8Array {
    const src = uint8array
    const srcLength = src.byteLength
    const dst = new Uint8Array(srcLength)
    let dstIdx = 0

    for (let i = 0; i < srcLength; i++) {
        // 跳过 0x00 0x00 后面的 0x03
        if (i >= 2 && src[i] === 0x03 && src[i - 1] === 0x00 && src[i - 2] === 0x00) {
            continue
        }
        dst[dstIdx] = src[i]
        dstIdx++
    }

    return new Uint8Array(dst.buffer, 0, dstIdx)
}

// ── 跳过缩放列表 ───────────────────────────────────────

function skipScalingList(gb: ExpGolomb, count: number): void {
    let lastScale = 8
    let nextScale = 8
    for (let j = 0; j < count; j++) {
        if (nextScale !== 0) {
            const deltaScale = gb.readSEG()
            nextScale = (lastScale + deltaScale + 256) % 256
        }
        lastScale = (nextScale === 0) ? lastScale : nextScale
    }
}

// ── 主解析函数 ─────────────────────────────────────────

/**
 * 解析 H.264 SPS 数据
 * @param sps 原始 SPS NAL 单元（包含起始码前导零字节）
 * @returns 解析后的 SPS 信息
 */
export function parseSPS(sps: Uint8Array): SpsInfo {
    // 1. EBSP → RBSP
    const rbsp = ebsp2rbsp(sps)
    const gb = new ExpGolomb(rbsp)

    // 2. 跳过 NAL 单元头 (1 byte)
    gb.readByte()

    // 3. 读取 profile / level
    const profileIdc = gb.readByte()
    // constraint_set_flags (6 bits) + reserved_zero_2bits
    gb.readByte()
    const levelIdc = gb.readByte()

    // 4. seq_parameter_set_id
    gb.readUEG()

    // 5. 高 profile 扩展
    let chromaFormatIdc = 1  // 默认 4:2:0
    let bitDepth = 8
    if (profileIdc === 100 || profileIdc === 110 || profileIdc === 122 || profileIdc === 244) {
        chromaFormatIdc = gb.readUEG()
        if (chromaFormatIdc === 3) {
            gb.readBits(1) // separate_colour_plane_flag
        }
        bitDepth = gb.readUEG() + 8
        gb.readUEG() // bit_depth_chroma_minus8
        gb.readBits(1) // qpprime_y_zero_transform_bypass_flag
        const seqScalingMatrixPresentFlag = gb.readBool()
        if (seqScalingMatrixPresentFlag) {
            const limit = (chromaFormatIdc !== 3) ? 8 : 12
            for (let i = 0; i < limit; i++) {
                const seqScalingListPresentFlag = gb.readBool()
                if (seqScalingListPresentFlag) {
                    if (i < 6) {
                        skipScalingList(gb, 16)
                    } else {
                        skipScalingList(gb, 64)
                    }
                }
            }
        }
    }

    // 6. log2_max_frame_num_minus4
    gb.readUEG()

    // 7. pic_order_cnt_type
    const picOrderCntType = gb.readUEG()
    if (picOrderCntType === 0) {
        gb.readUEG() // log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
        gb.readBits(1) // delta_pic_order_always_zero_flag
        gb.readSEG() // offset_for_non_ref_pic
        gb.readSEG() // offset_for_top_to_bottom_field
        const numRefFramesInPicOrderCntCycle = gb.readUEG()
        for (let i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
            gb.readSEG()
        }
    }

    // 8. max_num_ref_frames
    const refFrames = gb.readUEG()

    // 9. gaps_in_frame_num_value_allowed_flag
    gb.readBits(1)

    // 10. 图像尺寸
    const picWidthInMbsMinus1 = gb.readUEG()
    const picHeightInMapUnitsMinus1 = gb.readUEG()
    const frameMbsOnlyFlag = gb.readBits(1)

    if (frameMbsOnlyFlag === 0) {
        gb.readBits(1) // mb_adaptive_frame_field_flag
    }

    // 11. direct_8x8_inference_flag
    gb.readBits(1)

    // 12. frame_cropping_flag
    let frameCropLeftOffset = 0
    let frameCropRightOffset = 0
    let frameCropTopOffset = 0
    let frameCropBottomOffset = 0
    const frameCroppingFlag = gb.readBool()
    if (frameCroppingFlag) {
        frameCropLeftOffset = gb.readUEG()
        frameCropRightOffset = gb.readUEG()
        frameCropTopOffset = gb.readUEG()
        frameCropBottomOffset = gb.readUEG()
    }

    // 13. VUI 参数
    let sarWidth = 1
    let sarHeight = 1
    let fpsNum = 0
    let fpsDen = 0
    let fps = 0
    let fpsFixed = false

    const vuiParametersPresentFlag = gb.readBool()
    if (vuiParametersPresentFlag) {
        // aspect_ratio_info_present_flag
        const aspectRatioInfoPresentFlag = gb.readBool()
        if (aspectRatioInfoPresentFlag) {
            const aspectRatioIdc = gb.readByte()
            if (aspectRatioIdc > 0 && aspectRatioIdc < 16) {
                sarWidth = SAR_W_TABLE[aspectRatioIdc - 1]
                sarHeight = SAR_H_TABLE[aspectRatioIdc - 1]
            } else if (aspectRatioIdc === 255) {
                sarWidth = (gb.readByte() << 8) | gb.readByte()
                sarHeight = (gb.readByte() << 8) | gb.readByte()
            }
        }

        // overscan_info_present_flag
        const overscanInfoPresentFlag = gb.readBool()
        if (overscanInfoPresentFlag) {
            gb.readBool() // overscan_appropriate_flag
        }

        // video_signal_type_present_flag
        const videoSignalTypePresentFlag = gb.readBool()
        if (videoSignalTypePresentFlag) {
            gb.readBits(4) // video_format + video_full_range_flag (4 bits)
            const colourDescriptionPresentFlag = gb.readBool()
            if (colourDescriptionPresentFlag) {
                gb.readBits(24) // colour_primaries + transfer_characteristics + matrix_coefficients
            }
        }

        // chroma_loc_info_present_flag
        const chromaLocInfoPresentFlag = gb.readBool()
        if (chromaLocInfoPresentFlag) {
            gb.readUEG() // chroma_sample_loc_type_top_field
            gb.readUEG() // chroma_sample_loc_type_bottom_field
        }

        // timing_info_present_flag
        const timingInfoPresentFlag = gb.readBool()
        if (timingInfoPresentFlag) {
            const numUnitsInTick = gb.readBits(32)
            const timeScale = gb.readBits(32)
            fpsFixed = gb.readBool()

            fpsNum = timeScale
            fpsDen = numUnitsInTick * 2
            if (fpsDen > 0) {
                fps = fpsNum / fpsDen
            }
        }
    }

    // 14. 计算图像尺寸
    let codecWidth = (picWidthInMbsMinus1 + 1) * 16
    let codecHeight = (2 - frameMbsOnlyFlag) * ((picHeightInMapUnitsMinus1 + 1) * 16)

    // 15. 裁剪
    let cropUnitX: number
    let cropUnitY: number
    if (chromaFormatIdc === 0) {
        cropUnitX = 1
        cropUnitY = 2 - frameMbsOnlyFlag
    } else {
        const subWC = (chromaFormatIdc === 3) ? 1 : 2
        const subHC = (chromaFormatIdc === 1) ? 2 : 1
        cropUnitX = subWC
        cropUnitY = subHC * (2 - frameMbsOnlyFlag)
    }
    codecWidth -= (frameCropLeftOffset + frameCropRightOffset) * cropUnitX
    codecHeight -= (frameCropTopOffset + frameCropBottomOffset) * cropUnitY

    // 16. SAR 缩放
    const sarScale = sarWidth / sarHeight
    const presentWidth = Math.ceil(codecWidth * sarScale)

    // 17. 色度格式字符串
    let chromaFormatString: string
    switch (chromaFormatIdc) {
        case 0: chromaFormatString = '4:0:0'; break
        case 1: chromaFormatString = '4:2:0'; break
        case 2: chromaFormatString = '4:2:2'; break
        case 3: chromaFormatString = '4:4:4'; break
        default: chromaFormatString = 'Unknown'
    }

    gb.destroy()

    return {
        profile_string: getProfileString(profileIdc),
        level_string: (levelIdc / 10).toFixed(1),
        bit_depth: bitDepth,
        ref_frames: refFrames,
        chroma_format: chromaFormatIdc === 0 ? 420 : (chromaFormatIdc === 1 ? 420 : (chromaFormatIdc === 2 ? 422 : 444)),
        chroma_format_string: chromaFormatString,
        frame_rate: {
            fixed: fpsFixed,
            fps: fps,
            fps_den: fpsDen,
            fps_num: fpsNum,
        },
        sar_ratio: {
            width: sarWidth,
            height: sarHeight,
        },
        codec_size: {
            width: codecWidth,
            height: codecHeight,
        },
        present_size: {
            width: presentWidth,
            height: codecHeight,
        },
    }
}
