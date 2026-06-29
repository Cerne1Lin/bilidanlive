import { invoke } from "@tauri-apps/api/core";
import { ref, type Ref } from "vue";
import type { RoomInfo } from "../components/LiveInfo.vue";

export interface HistoryItem {
    title: string;
    cover: string;
    author_name: string;
    author_face: string;
    author_mid: number;
    view_at: number;
    tag_name: string;
    /** 直播间 id */
    room_id: number;
    /** 直播状态：0=未开播, 1=直播中 */
    live_status: number;
}

export interface LocalHistoryItem {
    title: string;
    cover: string;
    author_name: string;
    author_face: string;
    uid: number,
    room_id: number;
    tag_name: string;
    /** 进入时间戳（秒） */
    entered_at: number;
    /** 直播状态 */
    live_status: number;
}

const LOCAL_KEY = "bili_local_history";
const MAX_LOCAL = 30;

// ── 从 localStorage 恢复 ────────────────────────────

function loadLocalHistory(): LocalHistoryItem[] {
    try {
        const raw = localStorage.getItem(LOCAL_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveLocalHistory(list: LocalHistoryItem[]) {
    try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    } catch {
        /* 忽略存储满等异常 */
    }
}

// ── 服务器历史 ──────────────────────────────────────

async function getHistoryList(): Promise<HistoryItem[]> {
    return await invoke<HistoryItem[]>("get_history_list");
}

const historyList = ref<HistoryItem[]>([]);

async function loadHistoryList(): Promise<void> {
    historyList.value = await getHistoryList();
}

function clearHistoryList() {
    historyList.value = [];
}

// ── 本地历史 ────────────────────────────────────────

const localHistory = ref<LocalHistoryItem[]>(loadLocalHistory());

function addLocalHistory(room: RoomInfo) {
    // 去重：同 room_id 的先移除
    const list = localHistory.value.filter((it) => it.room_id !== room.room_id);
    list.unshift({
        title: room.title,
        cover: room.user_cover,
        author_name: room.user_info?.uname ?? "",
        author_face: room.user_info?.face ?? "",
        room_id: room.room_id,
        tag_name: room.area_name,
        entered_at: Math.floor(Date.now() / 1000),
        uid: room.user_info?.uid?? 0,
        live_status: room.live_status
    });
    if (list.length > MAX_LOCAL) list.length = MAX_LOCAL;
    localHistory.value = list;
    saveLocalHistory(list);
}

async function refreshLocalHistory() {
    const uidList = localHistory.value
        .map((item) => Number(item.uid))
        .filter((uid): uid is number => Number.isInteger(uid) && uid > 0);

    if (uidList.length === 0) {
        return;
    }

    const roomsInfo = await invoke<RoomInfo[]>('get_rooms_info', { uids: uidList });
    for (const i of roomsInfo) {
        const r = localHistory.value.find((val) => val.uid === i.uid);
        if (r) {
            r.author_face = i.user_info?.face ?? "";
            r.author_name = i.user_info?.uname ?? "";
            r.cover = i.user_cover;
            r.room_id = i.room_id;
            r.tag_name = i.area_name;
            r.title = i.title;
            r.live_status = i.live_status;
        }
    }
}

// ── 导出 ────────────────────────────────────────────

export function useHistoryList(): {
    historyList: Ref<HistoryItem[]>;
    localHistory: Ref<LocalHistoryItem[]>;
    loadHistoryList: () => Promise<void>;
    clearHistoryList: () => void;
    addLocalHistory: (room: RoomInfo) => void;
    refreshLocalHistory: () => Promise<void>;
} {
    return {
        historyList,
        localHistory,
        loadHistoryList,
        clearHistoryList,
        addLocalHistory,
        refreshLocalHistory,
    };
}

export { getHistoryList, addLocalHistory };
