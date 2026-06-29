<script lang="ts" setup>
import { watch, ref, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import ChatHistory from "../components/ChatHistory.vue";
import LiveInfo from "../components/LiveInfo.vue";
import { danmuList } from "../detail/DanData";
import { useLiveControl } from "../detail/LiveControl";
import { scList } from "../detail/SuperChat.ts";
import { pendingSize } from "../detail/DanData.ts";
import { openBiliLiveRoom } from "../detail/Opener.ts";
import { setWindowTransparent } from "../detail/WindowControl.ts";
import { hlColor, accentColor, bgLightColor } from "../detail/Theme.ts";

const route = useRoute();
let roomId: number | null = null;
const liveInfoRef = ref<InstanceType<typeof LiveInfo> | null>(null);

let unwatchVideoCanvas: (() => void) | null = null;

onMounted(() => {
    unwatchVideoCanvas = watch(
        liveInfoRef,
        (comp) => {
            if (comp?.videoCanvas) {
                bindVideoCanvas(comp.videoCanvas);
                unwatchVideoCanvas?.();
            }
        },
        { immediate: true },
    );
});

onUnmounted(() => {
    unwatchVideoCanvas?.();
});

const {
    roomInfo,
    isMute,
    volume,
    danmuStatus,
    isConnecting,
    isConnected,
    currentRoomId,
    isPlaying,
    isVideoPlaying,
    linkToRoom,
    toggleMute,
    changeVolume,
    toggleDanmu,
    togglePlayPause,
    flushAll,
    disconnectAll,
    wsConnected,
    wsConnecting,
    bindVideoCanvas,
    audioOnly,
    toggleAudioOnly,
} = useLiveControl();

watch(
    () => route.query.roomId,
    (id) => {
        const num = Number(id);
        roomId = num;
        if (num > 0) linkToRoom(num);
    },
    { immediate: true },
);

async function linkAll(id: number): Promise<boolean> {
    roomId = id;
    return linkToRoom(id);
}

async function close() {
    await disconnectAll();
    setWindowTransparent(false);
}
</script>

<template>
    <div class="container-box">
        <LiveInfo
            ref="liveInfoRef"
            class="live-info"
            :room-info="roomInfo"
            :is-mute="isMute"
            :volume="volume"
            :show-danmu="danmuStatus"
            :is-connecting="isConnecting"
            :is-connected="isConnected"
            :room-id="currentRoomId"
            :on-link-to-room="linkAll"
            :is-audio-only="audioOnly"
            @toogle-audio-only="toggleAudioOnly"
            @toggle-mute="toggleMute"
            @volume-change="changeVolume"
            @toggle-danmu="toggleDanmu"
            @toggle-play="togglePlayPause"
            :is-playing="isPlaying"
            :is-video-playing="isVideoPlaying"
            @flush="
                () => {
                    if (roomId) flushAll(roomId);
                }
            "
            @disconnect-all="close"
            @open-bili-live-room="
                () => {
                    if (roomId) openBiliLiveRoom(roomId);
                }
            "
            :accent-color="accentColor"
            :bg-color="bgLightColor"
            :hl-color="hlColor"
        />
        <ChatHistory
            class="chat-history"
            :danmu-items="danmuList"
            :sc-items="scList"
            :pending-size="pendingSize"
            :is-connected="wsConnected"
            :is-connecting="wsConnecting"
            :accent-color="accentColor"
            :bg-color="bgLightColor"
            :hl-color="hlColor"
        />
    </div>
</template>

<style scoped>
.container-box {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    gap: 8px;
}
.chat-history {
    flex-grow: 1;
}
</style>
