<template>
    <div class="sc-container">
        <div class="sc-list">
            <div
                v-for="item in items"
                :key="item.id"
                class="sc-item"
                :style="progressStyle(item)"
                @click="toggleDetail(item)"
            >
                <div class="avater"><BiliImg :src="item.user_info.face" :default="img.defaultFace"/></div>
                <span class="sc-value">{{ item.price + 'CNY' }}</span>
            </div>
        </div>
        <ScItemDetail
          v-if="selectedSc"
          class="sc-detail"
          :face="selectedSc.user_info.face"
          :name="selectedSc.user_info.uname"
          :text="selectedSc.message"
          :price="selectedSc.price"
          @click="selectedSc = null"
        />
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import BiliImg from './BiliImg.vue'
import ScItemDetail from './ScItem.vue'
import type { ScItem } from '../detail/SuperChat'
import Colors from '../detail/Colors.ts'
import { img } from '../detail/Assets.ts'

const props = defineProps<{
    items: ScItem[]
}>()

const emit = defineEmits<{
    (e: 'select', item: ScItem): void
    (e: 'remove', id: number): void
}>()

const selectedSc = ref<ScItem | null>(null)
const now = ref(Date.now())

// ── 进度条计时器 ──────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
    timer = setInterval(() => { now.value = Date.now() }, 200)
})
onUnmounted(() => {
    if (timer) clearInterval(timer)
})

function toggleDetail(item: ScItem) {
    if (selectedSc.value?.id === item.id) {
        selectedSc.value = null
    } else {
        selectedSc.value = item
        emit('select', item)
    }
}

function progressStyle(item: ScItem): Record<string, string> {
    const elapsed = now.value - item.ts * 1000
    const pct = Math.max(0, Math.min(100, (1 - elapsed / item.time) * 100))
    const c = getColor(item)
    return {
        background: `linear-gradient(to right, ${c.front} ${pct}%, ${c.back} ${pct}%)`,
    }
}

// ── 检测 item 过期移除 ─────────────────────────────

let prevIds = new Set<number>()
watch(
    () => props.items,
    (list) => {
        const curIds = new Set(list.map(it => it.id))
        for (const id of prevIds) {
            if (!curIds.has(id)) {
                emit('remove', id)
                if (selectedSc.value?.id === id) selectedSc.value = null
            }
        }
        prevIds = curIds
        // 清理颜色缓存
        for (const id of colorCache.keys()) {
            if (!curIds.has(id)) colorCache.delete(id)
        }
    },
    { deep: true },
)

function colorByPrice(p: number) {
    if (p < 50) return { front: Colors.SC_BLUE_FRONT, back: Colors.SC_BLUE_DARK }
    if (p < 100) return { front: Colors.SC_GREYBLUE_FRONT, back: Colors.SC_GREYBLUE_DARK }
    if (p < 500) return { front: Colors.SC_YELLOW_FRONT, back: Colors.SC_YELLOW_DARK }
    if (p < 1000) return { front: Colors.SC_ORANGE_FRONT, back: Colors.SC_ORANGE_DARK }
    return { front: Colors.SC_RED_FRONT, back: Colors.SC_RED_DARK }
}

const colorCache = new Map<number, { front: string; back: string }>()

function getColor(item: ScItem) {
    let c = colorCache.get(item.id)
    if (!c) {
        c = colorByPrice(item.price)
        colorCache.set(item.id, c)
    }
    return c
}
</script>

<style scoped>
.sc-container {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.sc-detail {
    width: 100%;
    padding: 0 0.5em;
    box-sizing: border-box;
}
.sc-value {
    user-select: none;
    -webkit-user-drag: none;
    -webkit-user-select: none;
    color: white;
    font-weight: lighter;
}
.sc-list {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5em;
    width: 100%;
    padding: 0 0.5em;
    box-sizing: border-box;
    overflow-x: auto;
    overflow-y: hidden;
}
.sc-list::-webkit-scrollbar {
    display: none;
}

.avater {
    border-radius: 50%;
    height: 2em;
    aspect-ratio: 1;
    background-color: gray;
    margin: 0.2em;
    overflow: hidden;
}
.avater :deep(img){
    height: 100%;
    width: 100%;
}
.sc-item {
    border-radius: 9999px;
    display: flex;
    margin: 5px 0 5px;
    align-items: center;
    gap: 0.3em;
    padding-right: 1em;
    cursor: pointer;
    transition: opacity 0.3s;
    min-width: 6em;
    box-sizing: border-box;
    flex-shrink: 0;
}
</style>
