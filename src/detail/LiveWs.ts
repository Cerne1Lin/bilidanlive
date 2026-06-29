import { Channel, invoke } from "@tauri-apps/api/core";
import { ref } from "vue";
import { addDanmu } from "./DanData";
import { addSc } from "./SuperChat";
import { addTip } from "../utility/tip";
import { error as logError } from "../utility/logger";

interface DanmuPayload {
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
    user: { uid: number; face: string; name: string };
    emoticon: { url: string; desc: string } | null;
    type: "text" | "emote";
}

interface ScPayload {
    id: number;
    message: string;
    price: number;
    time: number;
    ts: number;
    medal: {
        level: number;
        name: string;
        color: string;
        guard_level: number;
    } | null;
    user_info: { uid: number; face: string; uname: string };
}

interface RoomStatusPayload {
    online: number;
}
interface WsErrorPayload {
    message: string;
}

const liveOnline = ref(0);
let currentRoomId: number | null = null;
const isConnected = ref(false);
const isConnecting = ref(false);

async function connect(roomId: number) {
    if (isConnected.value) await disconnect();
    isConnecting.value = true;

    const danmuChannel = new Channel<DanmuPayload>();
    danmuChannel.onmessage = (payload) => {
        addDanmu({
            id: 0,
            ts: payload.ts,
            text: payload.text,
            nickname: payload.nickname,
            timeline: payload.timeline,
            medal: payload.medal,
            user: payload.user,
            emoticon: payload.emoticon,
            type: payload.type,
            sc: null,
        });
    };

    const scChannel = new Channel<ScPayload>();
    scChannel.onmessage = (payload) => {
        addSc({
            id: payload.id,
            message: payload.message,
            price: payload.price,
            time: payload.time * 1000,
            ts: payload.ts,
            medal: payload.medal,
            user_info: payload.user_info,
        });
    };

    const statusChannel = new Channel<RoomStatusPayload>();
    statusChannel.onmessage = (payload) => {
        liveOnline.value = payload.online;
    };

    const errorChannel = new Channel<WsErrorPayload>();
    errorChannel.onmessage = (payload) => {
        isConnecting.value = false;
        if (payload.message === "success") {
            isConnected.value = true;
            return;
        }
        isConnected.value = false;
        liveOnline.value = 0;
        logError(`[WSS] ${payload.message}`);
        addTip(`连接弹幕服务器失败:${payload.message}`, "error", -1);
    };

    await invoke("connect_live_room", {
        roomId,
        danmuChannel,
        scChannel,
        statusChannel,
        errorChannel,
    });
}

async function disconnect() {
    if (!isConnected.value) return;
    await invoke("disconnect_live_room");
    isConnected.value = false;
    liveOnline.value = 0;
}

async function connectLiveRoom(id: number) {
    if (id === currentRoomId && isConnected.value) return;
    currentRoomId = id;
    await connect(id);
}

async function disconnectLiveRoom() {
    currentRoomId = null;
    await disconnect();
}

function getCurrentRoomId() {
    return currentRoomId;
}

async function toggleConnect() {
    if (isConnected.value) {
        await disconnect();
    } else if (currentRoomId) {
        await connect(currentRoomId);
    }
}

function setCurrentRoomId(id: number) {
    currentRoomId = id;
}

export default {
    isConnected,
    liveOnline,
    isConnecting,
    connectLiveRoom,
    disconnectLiveRoom,
    getCurrentRoomId,
    toggleConnect,
    setCurrentRoomId,
} as const;
