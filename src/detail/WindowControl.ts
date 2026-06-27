import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";
import { error as logError, debug as logDebug } from "../utility/logger";

export const isTransparentBack = ref(false)

export function setWindowTransparent(is:boolean) {
    try {
        isTransparentBack.value = is
        return invoke('set_window_transparent', { transparent: is })
    } catch (err) {
        logError(`[Window] 设置窗口透明失败: ${err}`)
    }
}

export function toggleWindowTransparent() {
    try {
        const to = !isTransparentBack.value
        setWindowTransparent(to)
        logDebug(`[Window] isTransparent: ${isTransparentBack.value}`)
    } catch (err) {
        logError(`[Window] 切换窗口透明失败: ${err}`)
    }
}