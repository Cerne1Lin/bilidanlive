<template>
    <div class="bili-img-wrapper">
        <div class="placeholder" v-show="!dataUrl && !defaultUrl">
            <span
                class="dot"
                v-for="i in 3"
                :key="i"
                :style="{ animationDelay: `${(i - 1) * 0.25}s` }"
            ></span>
        </div>
        <img
            v-show="dataUrl || defaultUrl"
            :src="dataUrl || defaultUrl || undefined"
            :class="{ loaded: loaded || !!defaultUrl }"
            :style="{ background: props.bgColor }"
            @load="onLoad"
            @error="onError"
        />
    </div>
</template>

<script setup lang="ts">
import { ref, watch, toRef, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";

const props = withDefaults(
    defineProps<{
        src?: string;
        default?: string;
        bgColor?: string;
        maxRetries?: number;
        useDisk?: boolean;
    }>(),
    {
        src: "",
        default: "",
        bgColor: "rgba(255, 255, 255, 0.15)",
        maxRetries: 3,
        useDisk: false,
    },
);

const dataUrl = ref("");
const defaultUrl = ref("");
const loaded = ref(false);

let retries = 0;
let pendingUrl = "";

async function convert(url: string) {
    loaded.value = false;
    dataUrl.value = "";
    pendingUrl = url;

    if (!url) return;
    if (url.startsWith("data:")) {
        dataUrl.value = url;
        loaded.value = true;
        return;
    }

    try {
        dataUrl.value = await invoke<string>("fetch_image_base64", {
            url,
            useDisk: props.useDisk,
        });
        loaded.value = true;
    } catch {
        scheduleRetry();
    }
}

async function loadDefault(url: string) {
    if (!url || url.startsWith("data:")) {
        defaultUrl.value = url || "";
        return;
    }
    if (url.startsWith("/") || url.startsWith("tauri://")) {
        defaultUrl.value = url;
        return;
    }
    try {
        defaultUrl.value = await invoke<string>("fetch_image_base64", {
            url,
            useDisk: props.useDisk,
        });
    } catch {
        defaultUrl.value = "";
    }
}

function scheduleRetry() {
    if (pendingUrl && retries < props.maxRetries) {
        retries++;
        convert(pendingUrl);
    }
}

function onLoad() {
    retries = 0;
    loaded.value = true;
}

function onError() {
    scheduleRetry();
}

watch(
    toRef(props, "src"),
    (newUrl) => {
        retries = 0;
        convert(newUrl || "");
    },
    { immediate: true },
);

watch(
    toRef(props, "default"),
    (newUrl) => {
        loadDefault(newUrl || "");
    },
    { immediate: true },
);

onUnmounted(() => {});
</script>

<style scoped>
.bili-img-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
}
.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.05);
}

.dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #999;
    opacity: 0.3;
    animation: dotPulse 0.75s ease-in-out infinite;
}

@keyframes dotPulse {
    0% {
        transform: scale(0.6);
        opacity: 0.2;
    }
    40% {
        transform: scale(1.4);
        opacity: 0.9;
    }
    100% {
        transform: scale(0.6);
        opacity: 0.2;
    }
}

img {
    opacity: 0;
    transition: opacity 0.3s ease;
    height: 100%;
    width: 100%;
}
img.loaded {
    opacity: 1;
}
</style>
