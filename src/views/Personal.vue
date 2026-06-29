<template>
    <PersonalPage
        :user-info="userInfo"
        :following-live="followingLive"
        :is-loading="isLoading"
        :history-items="displayHistory"
        @login-success="load"
        @logout="clearAll"
        @flush="flush"
        @enter-room="enterRoom"
        :hl-color="hlColor"
        :accent-color="accentColor"
        :bg-color="bgLightColor"
    />
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import PersonalPage from "../components/PersonalPage.vue";
import { usePersonalData } from "../detail/PersonalData";
import { onMounted } from "vue";
import { addTip } from "../utility/tip";
import { useFollowingLive } from "../detail/FollowingLive.ts";
import { ref } from "vue";
import { useHistoryList, type HistoryItem } from "../detail/HistoryList.ts";
import { computed } from "vue";
import { hlColor, bgLightColor, accentColor } from "../detail/Theme.ts";
import { error } from "@tauri-apps/plugin-log";

// ── 个人数据 ────────────────────────────────────────

const router = useRouter();
const { userInfo, loadUserInfo, clearSign } = usePersonalData();
const { followingLive, loadFollowingLives, clearFollowingLive } =
    useFollowingLive();
const { historyList, localHistory, loadHistoryList, refreshLocalHistory } = useHistoryList();

// 已登录 → 服务器历史，未登录 → 本地历史
const displayHistory = computed<HistoryItem[]>(() => {
    if (userInfo.value.is_login) return historyList.value;
    return localHistory.value.map((it) => ({
        title: it.title,
        cover: it.cover,
        author_name: it.author_name,
        author_face: it.author_face,
        author_mid: 0,
        view_at: it.entered_at,
        tag_name: it.tag_name,
        room_id: it.room_id,
        live_status: it.live_status,
    }));
});
const isLoading = ref({
    uLoading: false,
    fLoading: false,
    hLoading: false,
});

async function load() {
    try {
        isLoading.value.fLoading = true;
        isLoading.value.uLoading = true;
        isLoading.value.hLoading = true;
        await loadUserInfo();
        if (userInfo.value.is_login) {
            await loadFollowingLives();
            await loadHistoryList();
        } else {
            await refreshLocalHistory();       
        }
    } catch (err) {
        error(`[personal_page] load error ${err}`)
        addTip(String(err), "error", -1);
    } finally {
        isLoading.value.fLoading = false;
        isLoading.value.uLoading = false;
        isLoading.value.hLoading = false;
    }
}

function clearAll() {
    try {
        clearFollowingLive();
        clearSign();
    } catch (err) {
        error(`[personal_page] clear all error ${err}`)
        addTip(String(err), "error", 3);
    }
}

async function flush() {
    try {
        if (userInfo.value.is_login) {
            isLoading.value.fLoading = true;
            await loadFollowingLives();
            isLoading.value.hLoading = true;
            await loadHistoryList();
        } else {
            isLoading.value.hLoading = true
            await refreshLocalHistory()
        }
    } catch (err) {
        error(`[personal_page] flush error ${err}`)
        addTip(String(err), "error", -1);
    } finally {
        isLoading.value.fLoading = false;
        isLoading.value.hLoading = false;
    }
}
function enterRoom(roomId: number) {
    router.push({ path: "/", query: { roomId } });
}

onMounted(async () => {
    await load();
});
</script>

<style scoped></style>
