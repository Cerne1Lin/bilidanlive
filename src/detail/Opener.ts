import { openUrl } from "@tauri-apps/plugin-opener";

export async function openBiliSpace(uid: number) {
    const url = "https://space.bilibili.com/" + uid
    await openUrl(url)
}

export async function openBiliLiveRoom(roomId: number) {
    const url = "https://live.bilibili.com/" + roomId
    await openUrl(url)
}