<template>
    <div class="titlebar" data-tauri-drag-region>
        <div class="nav" ref="navRef" v-show="!Immersive.isImmersive.value">
            <div
                class="nav-item"
                :class="{ 'nav-item--active': isActive(item.to) }"
                v-for="item in props.navItems"
                :key="item.to"
                @click="navigateTo(item.to)"
            >
                <div class="icon"><SvgIcon :svg-raw="item.svg" /></div>
                <div class="nav-text">{{ item.text }}</div>
            </div>
        </div>
        <div class="summary" v-show="Immersive.isImmersive.value">
            <div class="summary-track">
                <span>{{ Immersive.summary.value }}</span
                ><span>{{ Immersive.summary.value }}</span>
            </div>
        </div>
        <div class="buttons">
            <div class="btn icon" id="pin" @click="togglePin">
                <SvgIcon :svg-raw="isPin ? svg.pinFillSvg : svg.pinSvg" />
            </div>
            <div class="btn icon" id="minimize" @click="appWindow.minimize">
                <SvgIcon :svg-raw="svg.minimizeSvg" />
            </div>
            <div class="btn icon" id="close" @click="appWindow.close">
                <SvgIcon :svg-raw="svg.closeSvg" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Window } from "@tauri-apps/api/window";
import { useRouter, useRoute } from "vue-router";
import { svg } from "../detail/Assets";
import SvgIcon from "./SvgIcon.vue";
import { ref } from "vue";
import Immersive from "../detail/Immersive.ts";
import { radius } from "../detail/Theme.ts";

const appWindow = new Window("main");
const router = useRouter();
const route = useRoute();
const isPin = ref(false);

const props = withDefaults(
    defineProps<{
        height?: string;
        bgColor?: string;
        activeColor?: string;
        iconColor?: string;
        activeIconColor?: string;
        navItems?: {
            svg: string;
            text: string;
            to: string;
        }[];
    }>(),
    {
        height: "2em",
        bgColor: "transparent",
        activeColor: "white",
        iconColor: "white",
        activeIconColor: "pink",
        navItems: () => [],
    },
);

async function togglePin() {
    if (isPin.value) {
        await appWindow.setAlwaysOnTop(false);
        isPin.value = false;
    } else {
        await appWindow.setAlwaysOnTop(true);
        isPin.value = true;
    }
}

function navigateTo(path: string) {
    if (path && router.currentRoute.value.path !== path) {
        router.push(path);
    }
}

function isActive(path: string): boolean {
    return route.path === path;
}
</script>

<style scoped>
.summary {
    color: v-bind("props.activeIconColor");
    overflow: hidden;
    flex: 1;
    min-width: 0;
    mask-image: linear-gradient(
        to right,
        transparent 0%,
        black 10%,
        black 90%,
        transparent 100%
    );
    -webkit-mask-image: linear-gradient(
        to right,
        transparent 0%,
        black 10%,
        black 90%,
        transparent 100%
    );
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
}
.summary-track {
    display: flex;
    white-space: nowrap;
    width: max-content;
    animation: marquee 12s linear infinite;
}
.summary-track span {
    flex-shrink: 0;
    padding-right: 2em;
}
@keyframes marquee {
    from {
        transform: translateX(0);
    }
    to {
        transform: translateX(-50%);
    }
}

.titlebar {
    height: v-bind("props.height");
    display: flex;
    justify-content: start;
    background-color: v-bind("props.bgColor");
    border: 2px solid v-bind("props.activeIconColor");
    border-bottom: none;
    border-radius: v-bind("radius") v-bind("radius") 0 0;
    overflow: hidden;
    background-color: v-bind("props.bgColor");
}
.nav {
    display: flex;
    position: relative;
    align-items: center;
    justify-content: space-around;
}
.nav .nav-item:first-child {
    padding-left: 0.7em;
}
.buttons .btn:last-child {
    margin-right: 0.7em;
}

.buttons {
    display: inline-flex;
    align-items: center;
    margin-left: auto;
}

.icon {
    height: 1.5em;
    aspect-ratio: 1;
    padding: 0.2em;
    -webkit-user-drag: none;
    color: v-bind("props.iconColor");
    transition: transform 0.2s ease;
    box-sizing: border-box;
}
.nav-item:hover .icon :deep(svg) {
    transform: scale(1.2); /* 1.7 / 1.5 */
}

.nav-item--active .icon {
    color: v-bind("props.activeIconColor");
}

.btn {
    border-radius: 50%;
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
}
.btn:hover {
    background-color: rgba(255, 255, 255, 0.25);
}
.btn:hover#close {
    transform: rotate(360deg);
}

.nav-item {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    border-radius: 16px 16px 0 0;
    position: relative;
    z-index: 1;
    padding: 0 0.5em;
    box-sizing: border-box;
    height: 100%;
    overflow: hidden;
}
.nav-item--active .nav-text {
    color: v-bind("props.activeIconColor");
}
.nav-text {
    font-size: 0.875em;
    color: v-bind("props.iconColor");
}
#pin :deep(svg) {
    transform: scale(1.25);
}
</style>
