// ── AMF0 解析器 ────────────────────────────────────────
// 解析 FLV script tag 中的 onMetaData。从 flv.js src/demux/amf-parser.js 移植。

// ── AMF0 类型常量 ──────────────────────────────────────
const AMF0_NUMBER = 0
const AMF0_BOOLEAN = 1
const AMF0_STRING = 2
const AMF0_OBJECT = 3
const AMF0_ECMA_ARRAY = 8
const AMF0_OBJECT_END = 9
const AMF0_STRICT_ARRAY = 10
const AMF0_DATE = 11
const AMF0_LONG_STRING = 12

// 检测平台字节序
const le = (() => {
    const buf = new ArrayBuffer(2)
    new DataView(buf).setInt16(0, 256, true) // little-endian
    return new Int16Array(buf)[0] === 256
})()

// ── UTF-8 解码 ─────────────────────────────────────────
function decodeUTF8(uint8array: Uint8Array): string {
    // 使用浏览器内置 TextDecoder
    return new TextDecoder('utf-8').decode(uint8array)
}

// ── 解析函数 ───────────────────────────────────────────

interface ParseResult {
    data: unknown
    size: number
    objectEnd?: boolean
}

function parseString(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number): ParseResult {
    if (dataSize < 2) {
        throw new Error('AMF: 数据不足以解析 String')
    }
    const v = new DataView(arrayBuffer, dataOffset, dataSize)
    const length = v.getUint16(0, !le)
    let str: string
    if (length > 0) {
        str = decodeUTF8(new Uint8Array(arrayBuffer, dataOffset + 2, length))
    } else {
        str = ''
    }
    return { data: str, size: 2 + length }
}

function parseLongString(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number): ParseResult {
    if (dataSize < 4) {
        throw new Error('AMF: 数据不足以解析 LongString')
    }
    const v = new DataView(arrayBuffer, dataOffset, dataSize)
    const length = v.getUint32(0, !le)
    let str: string
    if (length > 0) {
        str = decodeUTF8(new Uint8Array(arrayBuffer, dataOffset + 4, length))
    } else {
        str = ''
    }
    return { data: str, size: 4 + length }
}

function parseVariable(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number): ParseResult {
    if (dataSize < 3) {
        throw new Error('AMF: 数据不足以解析 ScriptDataObject')
    }
    const name = parseString(arrayBuffer, dataOffset, dataSize)
    const value = parseValue(arrayBuffer, dataOffset + name.size, dataSize - name.size)
    const isObjectEnd = value.objectEnd ?? false
    return {
        data: { name: name.data as string, value: value.data },
        size: name.size + value.size,
        objectEnd: isObjectEnd,
    }
}

function parseValue(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number): ParseResult {
    if (dataSize < 1) {
        throw new Error('AMF: 数据不足以解析 value')
    }
    const v = new DataView(arrayBuffer, dataOffset, dataSize)
    const type = v.getUint8(0)
    let offset = 1

    switch (type) {
        case AMF0_NUMBER: {
            if (dataSize < 9) {
                throw new Error('AMF: 数据不足以解析 Number')
            }
            const value = v.getFloat64(offset, !le)
            offset += 8
            return { data: value, size: offset }
        }
        case AMF0_BOOLEAN: {
            if (dataSize < 2) {
                throw new Error('AMF: 数据不足以解析 Boolean')
            }
            const value = v.getUint8(offset) !== 0
            offset += 1
            return { data: value, size: offset }
        }
        case AMF0_STRING: {
            const result = parseString(arrayBuffer, dataOffset + offset, dataSize - offset)
            return { data: result.data, size: offset + result.size }
        }
        case AMF0_OBJECT: {
            const value: Record<string, unknown> = {}
            // 处理可能的畸形 ObjectEnd 标记
            let terminal = 0
            if ((v.getUint32(dataSize - 4, !le) & 0x00ffffff) === 9) {
                terminal = 3
            }
            while (offset < dataSize - 4 - terminal) {
                const amfvar = parseVariable(arrayBuffer, dataOffset + offset, dataSize - offset - terminal)
                if (amfvar.objectEnd) break
                const varData = amfvar.data as { name: string; value: unknown }
                value[varData.name] = varData.value
                offset += amfvar.size
            }
            // 检查 ObjectEnd 标记
            if (offset <= dataSize - 3) {
                const marker = v.getUint32(offset - 1, !le) & 0x00ffffff
                if (marker === 9) {
                    offset += 3
                }
            }
            return { data: value, size: offset }
        }
        case AMF0_ECMA_ARRAY: {
            const value: Record<string, unknown> = {}
            offset += 4  // 跳过 4 字节 count
            let terminal = 0
            if ((v.getUint32(dataSize - 4, !le) & 0x00ffffff) === 9) {
                terminal = 3
            }
            while (offset < dataSize - 8 - terminal) {
                const amfvar = parseVariable(arrayBuffer, dataOffset + offset, dataSize - offset - terminal)
                if (amfvar.objectEnd) break
                const varData = amfvar.data as { name: string; value: unknown }
                value[varData.name] = varData.value
                offset += amfvar.size
            }
            if (offset <= dataSize - 3) {
                const marker = v.getUint32(offset - 1, !le) & 0x00ffffff
                if (marker === 9) {
                    offset += 3
                }
            }
            return { data: value, size: offset }
        }
        case AMF0_STRICT_ARRAY: {
            if (dataSize < 5) {
                throw new Error('AMF: 数据不足以解析 StrictArray')
            }
            const count = v.getUint32(offset, !le)
            offset += 4
            const arr: unknown[] = []
            for (let i = 0; i < count; i++) {
                const val = parseValue(arrayBuffer, dataOffset + offset, dataSize - offset)
                arr.push(val.data)
                offset += val.size
            }
            return { data: arr, size: offset }
        }
        case AMF0_DATE: {
            if (dataSize < 11) {
                throw new Error('AMF: 数据不足以解析 Date')
            }
            const ms = v.getFloat64(offset, !le)
            offset += 8
            // 跳过时区偏移（int16）
            offset += 2
            return { data: new Date(ms), size: offset }
        }
        case AMF0_LONG_STRING: {
            const result = parseLongString(arrayBuffer, dataOffset + offset, dataSize - offset)
            return { data: result.data, size: offset + result.size }
        }
        case AMF0_OBJECT_END: {
            return { data: undefined, size: 1, objectEnd: true }
        }
        default: {
            // 不支持的类型，跳过
            return { data: undefined, size: offset }
        }
    }
}

// ── 公开 API ────────────────────────────────────────────

/**
 * 解析 FLV Script Data（onMetaData）
 * @param arrayBuffer 原始字节的底层 ArrayBuffer
 * @param dataOffset 起始偏移
 * @param dataSize 数据大小
 * @returns 解析后的键值对，如 { onMetaData: { ... } }
 */
export function parseScriptData(
    arrayBuffer: ArrayBuffer,
    dataOffset: number,
    dataSize: number,
): Record<string, unknown> {
    const data: Record<string, unknown> = {}
    try {
        const name = parseValue(arrayBuffer, dataOffset, dataSize)
        const value = parseValue(arrayBuffer, dataOffset + name.size, dataSize - name.size)
        data[name.data as string] = value.data
    } catch (_e) {
        // 解析失败时返回空对象，不中断流
    }
    return data
}
