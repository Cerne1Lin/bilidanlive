import { computed, ref } from "vue";

export type DanmuType = "text" | "sc" | "emote";

export interface DanmuItem {
    id: number;
    ts: number;
    text: string;
    nickname: string;
    timeline: string;
    medal: {
        level: number;
        name: string;
        color: string;
        guard_level: number;
    } | null;
    user: {
        uid: number;
        face: string;
        name: string;
    };
    emoticon: {
        url: string;
        desc: string;
    } | null;
    type: DanmuType;
    sc: {
        time: number;
        id: number;
        price: number;
    } | null;
}

const CAPACITY = 200;
let head = 0;
let tail = 0;
let size = 0;
let data = new Array<DanmuItem>(CAPACITY);
let tick = ref(0);
let nextId = 0;

// ── 副环形队列（用户翻看历史时暂存） ──────────────

const PENDING_CAPACITY = 100;
const pendingData = new Array<DanmuItem>(PENDING_CAPACITY);
let pendingHead = 0;
let pendingTail = 0;
const pendingSize = ref(0);
let isPaused = false;

function addDanmu(dan: DanmuItem) {
    dan.id = nextId++;
    if (isPaused) {
        // 翻看历史中 → 暂存到副环形队列
        if (pendingSize.value === PENDING_CAPACITY) {
            pendingHead = (pendingHead + 1) % PENDING_CAPACITY;
            pendingSize.value--;
        }
        pendingData[pendingTail] = dan;
        pendingTail = (pendingTail + 1) % PENDING_CAPACITY;
        pendingSize.value++;
        return;
    }
    _pushToMain(dan);
}

function _pushToMain(dan: DanmuItem) {
    if (size === CAPACITY) {
        data[tail] = dan;
        head = (head + 1) % CAPACITY;
        tail = (tail + 1) % CAPACITY;
    } else {
        data[tail] = dan;
        tail = (tail + 1) % CAPACITY;
        size++;
    }
    tick.value++;
}

function toArray(): DanmuItem[] {
    if (size === 0) return [];
    const result = [];
    for (let i = 0; i < size; i++) {
        result.push(data[(head + i) % CAPACITY]);
    }
    return result;
}

const danmuList = computed(() => {
    void tick.value;
    return toArray();
});

function clearDanmu() {
    head = 0;
    tail = 0;
    size = 0;
    nextId = 0;
    data = new Array(CAPACITY);
    pendingHead = 0;
    pendingTail = 0;
    pendingSize.value = 0;
    isPaused = false;
    tick.value++;
}

/** 暂停主队列添加（用户翻看历史时） */
function pauseDanmu() {
    isPaused = true;
}

/** 恢复 → 将副队列弹幕依次加入主队列，然后清空 */
function resumeDanmu() {
    isPaused = false;
    while (pendingSize.value > 0) {
        _pushToMain(pendingData[pendingHead]);
        pendingHead = (pendingHead + 1) % PENDING_CAPACITY;
        pendingSize.value--;
    }
}

const historyTick = ref(0);
function notifyHistoryLoaded() {
    historyTick.value++;
}

export {
    addDanmu,
    clearDanmu,
    pauseDanmu,
    resumeDanmu,
    danmuList,
    pendingSize,
    historyTick,
    notifyHistoryLoaded,
};
