<template>
    <div
        class="svg-icon"
        :style="iconStyle"
        v-html="processed"
        v-bind="$attrs"
    />
</template>

<script setup lang="ts">
import { computed } from "vue";
import stripFill from "../utility/svg_strip_fill";

const props = withDefaults(
    defineProps<{
        svgRaw: string;
        color?: string;
        size?: string;
    }>(),
    {
        svgRaw: "",
        color: undefined,
        size: undefined,
    },
);

const processed = computed(() => stripFill(props.svgRaw));

const iconStyle = computed(() => ({
    ...(props.size ? { width: props.size, height: props.size } : {}),
    ...(props.color ? { color: props.color } : {}),
}));
</script>

<style scoped>
.svg-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.svg-icon :deep(svg) {
    width: 100%;
    height: 100%;
}
</style>
