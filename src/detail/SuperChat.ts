import { ref } from 'vue'
import type { DanmuItem } from './DanData'
import { addDanmu } from './DanData'

export interface MedalInfo {
    level: number
    name: string
    color: string
    guard_level: number
}

export interface ScItem {
    id: number
    message: string
    price: number
    time: number
    ts: number
    medal: MedalInfo | null
    user_info: {
        uid: number
        face: string
        uname: string
    }
}

const scList = ref<ScItem[]>([])

function addSc(sc: ScItem) {
    const id = sc.id
    const time = sc.time
    const idx = scList.value.findIndex(item => item.price <= sc.price)
    scList.value.splice(idx === -1 ? scList.value.length : idx, 0, sc)
    setTimeout(() => {
        rmSc(id)
    }, time)
    addDanmu(toDanmu(sc))
}

function rmSc(id: number) {
    const idx = scList.value.findIndex(item => item.id === id)
    if (idx !== -1) scList.value.splice(idx, 1)
}

function toDanmu(sc: ScItem): DanmuItem {
    return {
        id: 0,  // addDanmu 内会覆盖
        ts: sc.ts,
        text: sc.message,
        nickname: sc.user_info.uname,
        timeline: '',
        medal: sc.medal,
        user: {
            uid: sc.user_info.uid,
            face: sc.user_info.face,
            name: sc.user_info.uname,
        },
        emoticon: null,
        type: 'sc',
        sc: { time: sc.time, id: sc.id, price: sc.price },
    }
}

function clearSc() {
    scList.value = []
}

export { toDanmu }

export { scList, addSc, clearSc }
