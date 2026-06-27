// ── Exp-Golomb 位流读取器 ───────────────────────────────
// 用于 H.264 SPS 解析。从 flv.js src/demux/exp-golomb.js 移植。

export class ExpGolomb {
    private _buffer: Uint8Array
    private _bufferIndex: number
    private _totalBytes: number
    private _currentWord: number
    private _currentWordBitsLeft: number

    constructor(uint8array: Uint8Array) {
        this._buffer = uint8array
        this._bufferIndex = 0
        this._totalBytes = uint8array.byteLength
        this._currentWord = 0
        this._currentWordBitsLeft = 0
    }

    destroy() {
        this._buffer = new Uint8Array(0)
    }

    private _fillCurrentWord(): void {
        const bufferBytesLeft = this._totalBytes - this._bufferIndex
        if (bufferBytesLeft <= 0) {
            return
        }
        const bytesRead = Math.min(4, bufferBytesLeft)
        let word = 0
        for (let i = 0; i < bytesRead; i++) {
            word = (word << 8) | this._buffer[this._bufferIndex + i]
        }
        this._bufferIndex += bytesRead
        this._currentWord = word
        this._currentWordBitsLeft = bytesRead * 8
    }

    /** 读取指定数量比特（大端序，每次从 currentWord 高位取） */
    readBits(bits: number): number {
        if (bits > 32) {
            throw new Error('ExpGolomb: 一次最多读取 32 位')
        }
        if (bits <= this._currentWordBitsLeft) {
            // 当前字足够
            const result = this._currentWord >>> (this._currentWordBitsLeft - bits)
            this._currentWordBitsLeft -= bits
            // 清除已读位
            const mask = (1 << this._currentWordBitsLeft) - 1
            this._currentWord &= mask
            return result
        }
        // 跨字读取
        const bitsNeeded = bits - this._currentWordBitsLeft
        const leftPart = this._currentWord & ((1 << this._currentWordBitsLeft) - 1)
        this._fillCurrentWord()
        if (this._currentWordBitsLeft === 0) {
            // 缓冲区末尾，返回左侧剩余部分
            return leftPart << bitsNeeded
        }
        const rightPart = this.readBits(bitsNeeded)
        return (leftPart << bitsNeeded) | rightPart
    }

    readBool(): boolean {
        return this.readBits(1) !== 0
    }

    readByte(): number {
        return this.readBits(8)
    }

    /** 读取无符号 Exp-Golomb 编码 */
    readUEG(): number {
        let leadingZeros = 0
        while (this.readBits(1) === 0) {
            leadingZeros++
        }
        if (leadingZeros === 0) {
            return 0
        }
        const value = this.readBits(leadingZeros)
        return (1 << leadingZeros) - 1 + value
    }

    /** 读取有符号 Exp-Golomb 编码 */
    readSEG(): number {
        const ueg = this.readUEG()
        if (ueg % 2 === 1) {
            return (ueg + 1) >>> 1
        }
        return -(ueg >>> 1)
    }
}
