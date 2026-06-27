import { invoke } from "@tauri-apps/api/core"
import { ref, type Ref } from 'vue'

interface FollowingLiveItem {
    room_id: number,
    uid: number,
    uname: string,
    face: string,
    title: string,
    online: number,                // 在线人数（来自批量查询补齐）
    live_status: number,          // 1=直播中, 2=轮播中
    live_time: number,            // 已播时长(秒), hit_ab=true 时为 0
    area_name: string,         // 一级分区
    area_v2_name: string,      // 二级分区
    area_v2_parent_name: string, // 父分区名
    tag_name: string,          // 标签
    cover_url: string,         // 直播间封面（来自批量查询补齐）
    keyframe: string,
}

interface FollowingLiveRes {
    live_count: number,
    list: FollowingLiveItem[],
}

function createDefaultFollowingLive(): FollowingLiveRes {
    return {
        live_count: 0,
        list: [],
    }
}

async function getFollowingLives(): Promise<FollowingLiveRes> {
    return await invoke<FollowingLiveRes>('get_following_lives')
}

// ── 单例数据（所有组件共享同一份）──────────────────

const followingLive = ref<FollowingLiveRes>(createDefaultFollowingLive())

async function loadFollowingLives(): Promise<void> {
    followingLive.value = await getFollowingLives()
}

function clearFollowingLive() {
    followingLive.value = createDefaultFollowingLive()
}

export function useFollowingLive(): {
    followingLive: Ref<FollowingLiveRes>
    loadFollowingLives: () => Promise<void>
    clearFollowingLive: () => void
} {
    return { followingLive, loadFollowingLives, clearFollowingLive }
}

export { getFollowingLives, type FollowingLiveItem, type FollowingLiveRes }