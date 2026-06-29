<template>
    <div
        class="segmented-slider"
        :class="{ 'is-disabled': disabled }"
        :style="cssVars"
    >
        <div ref="trackRef" class="slider-track" @click="onTrackClick">
            <!-- Active track fill -->
            <div class="track-fill" :style="{ width: fillWidth }"></div>

            <!-- Tick marks + labels -->
            <div
                v-for="(seg, index) in segments"
                :key="index"
                class="tick-wrapper"
                :class="{ 'is-active': index <= activeIndex }"
                :style="{ left: calcPercent(index) }"
            >
                <div class="tick-dot"></div>
                <span class="tick-label">{{ seg.label }}</span>
            </div>

            <!-- Thumb -->
            <div
                class="slider-thumb"
                :class="{ 'is-dragging': isDragging }"
                :style="{ left: thumbLeft }"
                @mousedown.prevent="onDragStart"
                @touchstart.prevent="onDragStart"
            ></div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

export interface Segment {
    label: string;
    value: string | number;
}

const props = withDefaults(
    defineProps<{
        /** 段定义数组：label 为刻度标签，value 为对应的值 */
        segments: Segment[];
        /** 是否禁用 */
        disabled?: boolean;
        /** 轨道高度（px），默认 4 */
        trackHeight?: number;
        /** 轨道背景色，默认 #e0e0e0 */
        trackColor?: string;
        /** 滑块填充前景色（起点到滑块位置），默认 #409eff */
        fillColor?: string;
        /** 节点大小 */
        dotSize?: number;
        /** 滑块大小 */
        thumbSize?: number;
    }>(),
    {
        segments: () => [],
        disabled: false,
        trackHeight: 6,
        trackColor: "gery",
        fillColor: "pink",
        dotSize: 8,
        thumbSize: 12,
    },
);

const modelValue = defineModel<string | number>();

const trackRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

// 当前激活的段索引（内部追踪，方便拖拽）
const activeIndex = computed(() => {
    if (props.segments.length === 0) return 0;
    const idx = props.segments.findIndex((s) => s.value === modelValue.value);
    return idx >= 0 ? idx : 0;
});

// 位置百分比
function calcPercent(index: number): string {
    if (props.segments.length <= 1) return `${props.dotSize / 2}px`;
    if (trackRef.value) {
        let width =
            (trackRef.value?.getBoundingClientRect().width - props.dotSize) *
            (index / (props.segments.length - 1));
        return `${width + props.dotSize / 2}px`;
    }
    return `${props.dotSize / 2}px`;
}

// 激活填充宽度
const fillWidth = computed(() => calcPercent(activeIndex.value));

// 拇指位置
const thumbLeft = computed(() => calcPercent(activeIndex.value));

// CSS 自定义属性，供模板绑定到根元素
const cssVars = computed(() => ({
    "--slider-track-height": `${props.trackHeight}px`,
    "--slider-track-color": props.trackColor,
    "--slider-fill-color": props.fillColor,
    "--dot-size": `${props.dotSize}px`,
    "--slider-thumb-size": `${props.thumbSize}px`,
}));

// ---- 交互逻辑 ----

function getNearestIndex(clientX: number): number {
    if (!trackRef.value || props.segments.length === 0) return 0;
    const rect = trackRef.value.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

    if (props.segments.length === 1) return 0;

    // 将连续比例映射到最近的段索引
    const steps = props.segments.length - 1;
    return Math.round(ratio * steps);
}

function commitIndex(index: number) {
    if (props.disabled) return;
    const clamped = Math.max(0, Math.min(props.segments.length - 1, index));
    const seg = props.segments[clamped];
    if (seg && seg.value !== modelValue.value) {
        modelValue.value = seg.value;
    }
}

function onTrackClick(e: MouseEvent) {
    if (props.disabled) return;
    const idx = getNearestIndex(e.clientX);
    commitIndex(idx);
}

function onDragStart(_e: MouseEvent | TouchEvent) {
    if (props.disabled) return;
    isDragging.value = true;

    const onMove = (ev: MouseEvent | TouchEvent) => {
        const clientX =
            ev instanceof MouseEvent ? ev.clientX : ev.touches[0].clientX;
        const idx = getNearestIndex(clientX);
        commitIndex(idx);
    };

    const onUp = () => {
        isDragging.value = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
}
</script>

<style scoped>
.segmented-slider {
    width: 100%;
    min-height: 2em;
    box-sizing: border-box;
    user-select: none;
}

.slider-track {
    position: relative;
    width: 100%;
    height: var(--slider-track-height);
    background: var(--slider-track-color);
    border-radius: calc(var(--slider-track-height) / 2);
    cursor: pointer;
    box-sizing: border-box;
}

.segmented-slider.is-disabled {
    opacity: 0.4;
    pointer-events: none;
}

.track-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: var(--slider-fill-color);
    border-radius: calc(var(--slider-track-height) / 2);
    transition: width 0.15s ease;
    pointer-events: none;
}

/* 刻度点 + 标签 */
.tick-wrapper {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
}

.tick-dot {
    width: var(--dot-size);
    height: var(--dot-size);
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--slider-track-color);
    box-shadow: 0 0 0 1px var(--slider-track-color);
    /* 圆点圆心对齐轨道中线：轨道高度/2 - 圆点半径 */
    margin-top: calc(var(--slider-track-height) / 2 - var(--dot-size) / 2);
    transition:
        background 0.15s ease,
        box-shadow 0.15s ease;
}

.tick-wrapper.is-active .tick-dot {
    background: var(--slider-fill-color);
    box-shadow: 0 0 0 1px var(--slider-fill-color);
}

.tick-label {
    margin-top: 6px;
    font-size: 12px;
    color: #999;
    white-space: nowrap;
    transition: color 0.15s ease;
}

.tick-wrapper.is-active .tick-label {
    color: var(--slider-fill-color);
    font-weight: 500;
}

/* 拇指 */
.slider-thumb {
    position: absolute;
    top: 50%;
    width: var(--slider-thumb-size);
    height: var(--slider-thumb-size);
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--slider-fill-color);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    transform: translate(-50%, -50%);
    transition:
        left 0.15s ease,
        box-shadow 0.15s ease;
    cursor: grab;
    pointer-events: auto;
    z-index: 2;
}

.slider-thumb:active,
.slider-thumb.is-dragging {
    cursor: grabbing;
    box-shadow: 0 1px 8px
        color-mix(in srgb, var(--slider-fill-color) 40%, transparent);
    transform: translate(-50%, -50%) scale(1.1);
}
</style>
