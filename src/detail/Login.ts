import { invoke } from '@tauri-apps/api/core'

// ── 类型定义 ──────────────────────────────────────────
interface QrcodeRes {
    code: number,
    message: string | null,
    data: {
        url: string,
        qrcode_key: string
    } | null
}

async function getQrcode(): Promise<QrcodeRes> {
    try {
        return await invoke<QrcodeRes>('get_login_qrcode')
    } catch(err) {
        return {code: -1, message: null, data: null}
    }
}
enum QRCODE_STATE {
    PENDING = 'pending',
    SCANNED = 'scanned',
    SUCCESS = 'success',
    EXPIRED = 'expired',
    UNKNOWN = 'unknown'
}

interface QrcodeState {
    status: string,
    message: string,
}

async function checkQrcodeState(qrcodeKey: string): Promise<QrcodeState> {
    try {
        return await invoke<QrcodeState>('check_qrcode_status', { qrcodeKey })
    } catch (err) {
        return {status: 'unknown', message: '发生错误'}
    }
}

interface LoginStatusRes {
    logged_in: boolean
    needs_refresh: boolean
    message: string
}

// ── 启动时检查 / 手动检查 cookie 状态（必要时自动刷新）──────

async function checkAndRefreshCookie(): Promise<LoginStatusRes> {
    return await invoke<LoginStatusRes>('check_and_refresh_cookie')
}

async function getLoginStatus(): Promise<LoginStatusRes> {
    return await invoke<LoginStatusRes>('get_login_status')
}

async function clearCookies(): Promise<void> {
    return await invoke('clear_cookies')
}

// ── 导出 ─────────────────────────────────────────────

export { checkAndRefreshCookie, getQrcode, checkQrcodeState, getLoginStatus, clearCookies, type LoginStatusRes, type QrcodeRes, type QRCODE_STATE, type QrcodeState }

// ── 使用示例 ───────────────────────────────────────────

// // 1. 应用启动时
// const status = await checkAndRefreshCookie()
// if (status.logged_in) {
//     console.log(status.message)  // "cookie 有效" / "cookie 已刷新"
//     // 进入主页
// } else {
//     // 显示登录页
// }
//
// // 2. 扫码登录（见前面实现）
// // startLogin(...)
