<template>
    <div class="checkbox-container" :style="cssVars">
        <div
            class="item"
            v-for="item in data"
            :class="{ 'is-selected': item.value === modelValue }"
            @click="modelValue = item.value"
        >
            {{ item.label }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const modelValue = defineModel<string | number>();
const props = withDefaults(
    defineProps<{
        data?: {
            label: string;
            value: string | number;
        }[];
        bgColor?: string;
        accentColor?: string;
    }>(),
    {
        data: () => [],
        accentColor: "pink",
        bgColor: "white",
    },
);
const cssVars = computed(() => ({
    "--bg-color": props.bgColor,
    "--accent-color": props.accentColor,
}));
</script>

<style scoped>
.checkbox-container {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    width: 100%;
}
.item {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 0;
    padding: 8px;
    color: black;
    background-color: var(--bg-color);
    font: 0.8em bold;
    cursor: pointer;
}
.item:first-child {
    border-radius: 99px 0 0 99px;
}
.item:last-child {
    border-radius: 0 99px 99px 0;
}
.item.is-selected {
    color: white;
    background-color: var(--accent-color);
}
</style>
