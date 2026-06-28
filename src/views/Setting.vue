<template>
    <div class="set-container" :style="colors">
        <div class="items-container">
            <div class="title">
                <SvgIcon :svg-raw="svg.playSvg" :size="'1.2em'"/>
                <span>播放</span>
            </div>
            <SetItem
                v-for="item in settingItems.get('play')"
                :key="item.key"
                :icon="item.icon"
                :title="item.title"
                :desc="item.desc"
                :is-disable="false"
                :type="item.type"
                :segments="item.segments"
                :slider-max="item.sliderMax"
                :slider-min="item.sliderMin"
                :slider-value="item.sliderValue?.value"
                :toggle-value="item.toggleValue?.value"
                @update:slider-value="onSliderUpdate(item, $event)"
                @update:toggle-value="onToggleUpdate(item, $event)"
                :accent-color="accentColor"
                :bg-color="bgLightColor"
                :hl-color="hlColor"
            />
        </div>
        <div class="items-container">
            <div class="title">
                <SvgIcon :svg-raw="svg.themeSvg" :size="'1.2em'"/>
                <span>外观</span>
            </div>
            <SetItem
                v-for="item in settingItems.get('theme')"
                :key="item.key"
                :icon="item.icon"
                :title="item.title"
                :desc="item.desc"
                :is-disable="false"
                :type="item.type"
                :segments="item.segments"
                :slider-max="item.sliderMax"
                :slider-min="item.sliderMin"
                :slider-value="item.sliderValue?.value"
                :toggle-value="item.toggleValue?.value"
                @update:slider-value="onSliderUpdate(item, $event)"
                @update:toggle-value="onToggleUpdate(item, $event)"
                :accent-color="accentColor"
                :bg-color="bgLightColor"
                :hl-color="hlColor"
            />
            <div class="color-theme">
                <div class="sub-title">主题</div>
                <div class="color-list">
                    <div class="color-item" v-for="item in THEMES">
                        <div class="preview" 
                            :style="{backgroundColor: item.light, borderColor: item.medium}"
                            @click="setColorTheme(item)"
                        >
                            <SvgIcon :svg-raw="svg.checkSvg" :size="'36px'" :color="item.medium" v-show="settings.color.value === item.label"/>
                        </div>
                        <div class="color-name">{{ item.name }}</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="items-container">
            <div class="title">
                <SvgIcon :svg-raw="svg.otherSvg" :size="'1.2em'"/>
                <span>其他</span>
            </div>
            <SetItem
                v-for="item in settingItems.get('others')"
                :key="item.key"
                :icon="item.icon"
                :title="item.title"
                :desc="item.desc"
                :is-disable="false"
                :type="item.type"
                :segments="item.segments"
                :slider-max="item.sliderMax"
                :slider-min="item.sliderMin"
                :slider-value="item.sliderValue?.value"
                :toggle-value="item.toggleValue?.value"
                @update:slider-value="onSliderUpdate(item, $event)"
                @update:toggle-value="onToggleUpdate(item, $event)"
                :accent-color="accentColor"
                :bg-color="bgLightColor"
                :hl-color="hlColor"
            />
            <SetItem :title="'日志文件大小'" :desc="logSizeStr" :type="'text-btn'" :btn-text="'清除'" @btn-click="async () => {
                await cleanLog()
                await getLogSize()
            }"/>
            <SetItem :title="'关于'" :type="'none'" :icon="svg.aboutSvg" :accent-color="accentColor"/>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import SetItem from '../components/SetItem.vue';
import { settingItems, type SetItemRequire } from '../detail/Setting.ts';
import { THEMES, accentColor, hlColor, bgLightColor, ThemeColors } from '../detail/Theme.ts';
import settings from '../detail/Setting.ts'
import SvgIcon from '../components/SvgIcon.vue';
import { svg } from '../detail/Assets.ts';
import { logSize, getLogSize, cleanLog } from '../utility/logger.ts';

const colors = computed(() => ({
    '--hl-color': hlColor.value,
    '--accent-color': accentColor.value,
    '--bg-color': bgLightColor.value,
}))

const logSizeStr = computed(() => {
    if (logSize.value >= 1024 && logSize.value <= 1024 * 1024) {
        return (logSize.value / 1024).toFixed + 'KB' 
    } else if (logSize.value >= 1024 * 1024) {
        return (logSize.value / (1024 * 1024)).toFixed(2) + 'MB'
    } else {
        return logSize.value.toFixed(2) + 'B'
    }
})

onMounted(() => {
    getLogSize().then()
})

function onSliderUpdate(item: SetItemRequire, val: string | number) {
    if (item.sliderValue) item.sliderValue.value = val;
}
function onToggleUpdate(item: SetItemRequire, val: boolean) {
    if (item.toggleValue) item.toggleValue.value = val;
}

function setColorTheme(item: ThemeColors) {
    settings.color.value = item.label
}
</script>

<style scoped>
.items-container {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--accent-color);
    padding: 8px 0;
}
.title {
    color: var(--hl-color);
    font-size: 1.2em;
    display: flex;
    height: 1.5em;
    padding: 0 16px;
    gap: 8px;
    align-items: center;
}
.sub-title {
    color: var(--hl-color)
}
.color-name {
    color: var(--hl-color);
    font-size: 0.8em;
}
.color-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
}
.color-theme {
    display: flex;
    flex-direction: column;
    padding: 8px 16px;
    gap: 8px;
}
.color-list {
    display: flex;
    overflow-x: auto;
    gap: 16px;
    scrollbar-width: none;
}
.color-list::-webkit-scrollbar {
    display: none;
}
.preview {
    height: 48px;
    width: 48px;
    border-radius: 50%;
    transition: transform 0.5 ease;
    border-width: 4px;
    border-style: solid;
    box-sizing: border-box;
    cursor: pointer;
}
.preview:hover {
    transform: scale(0.9);
}
.set-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border-radius: 0 0 16px 16px;
    overflow-y: auto;
    border: 2px solid var(--accent-color);
    justify-content: flex-start;
    background-color: var(--bg-color);
}
</style>
