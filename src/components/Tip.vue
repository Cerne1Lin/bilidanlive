<template>
    <div class="tips-list">
        <TransitionGroup name="list" appear>
            <div
                class="tip-item"
                :class="item.level"
                v-for="item in items"
                :key="item.key"
            >
                <div class="icon" :class="item.level">
                    <SvgIcon :svg-raw="getIcon(item.level)" :size="'16px'" />
                </div>
                <div class="message">{{ item.message }}</div>
                <div
                    v-if="item.canClose"
                    class="icon"
                    id="close-btn"
                    @click="removeTip(item.key)"
                >
                    <SvgIcon :svg-raw="svg.closeSvg" :size="'16px'" />
                </div>
            </div>
        </TransitionGroup>
    </div>
</template>

<style scoped>
/* TransitionGroup 动画 */
.list-move,
.list-enter-active,
.list-leave-active {
    transition: all 0.5s ease;
}
.list-enter-from,
.list-leave-to {
    opacity: 0;
    transform: translateX(40px);
}
.tip-item.list-leave-active {
    position: absolute;
    left: 0;
    right: 0;
}

#close-btn {
    position: absolute;
    right: 5px;
}
.icon :deep(svg) {
    height: 100%;
}
.icon {
    height: 16px;
}
.message {
    display: -webkit-box;
    line-clamp: 4;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-width: 75%;
}

.tips-list {
    display: flex;
    flex-direction: column;
    width: 150px;
    gap: 6px;
    background-color: transparent;
    padding: 5px;
    font-size: 0.8em;
}
.tip-item {
    display: flex;
    position: relative;
    border-radius: 10px;
    min-height: 50px;
    border: 2px solid;
    justify-content: flex-start;
    align-items: center;
    gap: 5px;
    box-sizing: border-box;
    padding: 5px;
}
.tip-item.success {
    border-color: yellowgreen;
    background-color: rgb(232, 255, 185);
    color: yellowgreen;
}
.tip-item.warning {
    border-color: orange;
    background-color: rgb(245, 221, 175);
    color: orange;
}
.tip-item.error {
    border-color: rgb(249, 70, 70);
    background-color: rgb(255, 188, 188);
    color: rgb(249, 70, 70);
}
.tip-item.info {
    border-color: gray;
    background-color: rgb(198, 198, 198);
    color: gray;
}
</style>

<script setup lang="ts">
import { svg } from "../detail/Assets";
import SvgIcon from "./SvgIcon.vue";
import { type TipLevel, type TipItem, removeTip } from "../utility/tip";

defineProps<{
    items: TipItem[];
}>();
function getIcon(level: TipLevel): string {
    switch (level) {
        case "success":
            return svg.successSvg;
        case "info":
            return svg.infoSvg;
        case "warning":
            return svg.warningSvg;
        case "error":
            return svg.errorSvg;
    }
}
</script>
