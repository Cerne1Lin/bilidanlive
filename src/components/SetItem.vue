<template>
    <div class="container" :style="colors">
        <div class="label">
            <SvgIcon v-if="icon" class="icon" :svg-raw="icon ? icon : ''" />
            <div class="text">
                <div class="title">{{ title }}</div>
                <div class="desc">{{ desc }}</div>
            </div>
            <ToggleSwitch
                v-if="type === 'switch'"
                v-model:value="toggleValue"
                class="sw"
                :active-color="accentColor"
            />
            <div
                class="text-btn"
                :style="{ marginLeft: 'auto' }"
                v-if="type === 'text-btn'"
                @click="emit('btnClick')"
            >
                {{ btnText }}
            </div>
        </div>
        <div
            class="wrap"
            v-if="
                type === 'seg-slider' ||
                type === 'slider' ||
                type === 'checkbox-btn'
            "
        >
            <CheckboxBtn
                v-if="type === 'checkbox-btn'"
                :data="segments"
                v-model="sliderValue"
                :accent-color="accentColor"
            />
            <SegmentedSlider
                v-if="type === 'seg-slider'"
                v-model="sliderValue"
                :segments="segments"
                :track-height="6"
                track-color="grey"
                :fill-color="accentColor"
            />
            <input
                v-if="type === 'slider'"
                class="slider"
                type="range"
                :min="sliderMin"
                :max="sliderMax"
                :disabled="isDisable"
                :value="sliderValue"
                :style="{
                    background: `linear-gradient(to right, var(--main-color) 0%, var(--main-color) ${fillPercent}%, grey ${fillPercent}%, grey 100%)`,
                }"
                @input="onSliderInput"
            />
            <div class="slider-value" v-if="type === 'slider'">
                {{ sliderValue }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import SegmentedSlider, { Segment } from "./SegmentedSlider.vue";
import ToggleSwitch from "./ToggleSwitch.vue";
import SvgIcon from "./SvgIcon.vue";
import CheckboxBtn from "./CheckboxBtn.vue";

const props = withDefaults(
    defineProps<{
        icon?: string;
        type:
            | "switch"
            | "seg-slider"
            | "slider"
            | "none"
            | "text-btn"
            | "checkbox-btn";
        title?: string;
        hlColor?: string;
        accentColor?: string;
        segments?: Segment[];
        desc?: string;
        sliderMin?: number;
        sliderMax?: number;
        isDisable?: boolean;
        btnText?: string;
        bgColor?: string;
    }>(),
    {
        hlColor: "white",
        accentColor: "pink",
        segments: () => [],
        title: "",
        desc: "",
        sliderMax: 100,
        sliderMin: 0,
        isDisable: false,
        bgColor: "transparent",
    },
);
const toggleValue = defineModel<boolean>("toggleValue", { default: false });
const sliderValue = defineModel<string | number>("sliderValue", { default: 0 });
const emit = defineEmits<{
    (e: "btnClick"): void;
}>();

const fillPercent = computed(() => {
    if (props.type !== "slider" || props.isDisable) return 0;
    const range = props.sliderMax - props.sliderMin;
    if (range === 0) return 0;
    return Math.round(
        ((Number(sliderValue.value) - props.sliderMin) / range) * 100,
    );
});

function onSliderInput(e: Event) {
    const target = e.target as HTMLInputElement;
    sliderValue.value = Number(target.value);
}

const colors = computed(() => ({
    "--hl-color": props.hlColor,
    "--accent-color": props.accentColor,
    "--bg-color": props.bgColor,
}));
</script>

<style scoped>
.text-btn {
    color: var(--accent-color);
    opacity: 1;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
}
.text-btn:hover {
    opacity: 0.8;
}
.title {
    color: var(--hl-color);
}
.desc {
    font-size: 0.8em;
    color: rgb(176, 176, 176);
}
.text {
    display: flex;
    flex-direction: column;
}
.container {
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.icon {
    height: 1.2em;
    width: 1.2em;
    color: var(--accent-color);
}

.label {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 0.5em;
}
.sw {
    margin-left: auto;
}

.wrap {
    padding: 0 1em;
    box-sizing: border-box;
    min-height: 1em;
    position: relative;
}

.slider {
    display: block;
    width: 100%;
    height: 6px;
    appearance: none;
    background: transparent;
    border-radius: 99px;
    cursor: pointer;
    outline: none;
    box-sizing: border-box;
}
.slider::-webkit-slider-runnable-track {
    box-sizing: border-box;
}

.slider:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.slider::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent-color);
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.slider-value {
    margin-top: 8px;
    text-align: center;
    font-size: 13px;
    color: var(--hl-color);
}
</style>
