// ── Canvas 2D 视频渲染器 ──────────────────────────────

export class VideoRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private currentFrame: VideoFrame | null = null;

    /** 绑定渲染目标 canvas */
    bindCanvas(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
    }

    /** 解绑 canvas */
    unbindCanvas(): void {
        this.clear();
        this.canvas = null;
        this.ctx = null;
    }

    /** 渲染一帧 */
    draw(frame: VideoFrame): void {
        if (!this.ctx || !this.canvas) return;

        // HiDPI：将 canvas 内部分辨率对齐物理像素，避免模糊
        const dpr = window.devicePixelRatio || 1;
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        const iw = Math.round(cw * dpr);
        const ih = Math.round(ch * dpr);
        if (this.canvas.width !== iw || this.canvas.height !== ih) {
            this.canvas.width = iw;
            this.canvas.height = ih;
        }

        // 关闭旧帧
        if (this.currentFrame) {
            this.currentFrame.close();
        }
        this.currentFrame = frame;

        this.ctx.drawImage(frame, 0, 0, iw, ih);
    }

    /** 清空画布并释放帧 */
    clear(): void {
        if (this.currentFrame) {
            this.currentFrame.close();
            this.currentFrame = null;
        }
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    /** 完全释放资源 */
    dispose(): void {
        this.clear();
        this.canvas = null;
        this.ctx = null;
    }
}
