import { invoke } from '@tauri-apps/api/core'
import { ref, type Ref } from 'vue'
import { getLoginStatus, clearCookies } from './Login'

interface NavLevelInfo {
    current_level: number,
    current_exp: number,
    next_exp: string,
}

interface NavUserInfo {
    is_login: boolean,
    face: string,
    mid: number,
    uname: string,
    level_info: NavLevelInfo,
}

function createDefaultUserInfo(): NavUserInfo {
    return {
        is_login: false,
        face: '',
        mid: 0,
        uname: '未登录',
        level_info: { current_level: 0, current_exp: 0, next_exp: '0' },
    }
}

async function getNavUserInfo(): Promise<NavUserInfo> {
    return await invoke<NavUserInfo>('get_nav_user_info')
}

// ── 单例数据（所有组件共享同一份）──────────────────

const userInfo = ref<NavUserInfo>(createDefaultUserInfo())

async function loadUserInfo(): Promise<void> {
    const status = await getLoginStatus()
    if (status.logged_in) {
        userInfo.value = await getNavUserInfo()
    }
}

function clearSign() {
    clearCookies().then(() => {
        userInfo.value = createDefaultUserInfo()
    })
}

export function usePersonalData(): {
    userInfo: Ref<NavUserInfo>
    loadUserInfo: () => Promise<void>
    clearSign: () => void
} {
    return { userInfo, loadUserInfo, clearSign }
}

export { getNavUserInfo, type NavUserInfo, type NavLevelInfo }
