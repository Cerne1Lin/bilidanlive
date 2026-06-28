import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";
import { error as logError, debug as logDebug } from "../utility/logger";
import { Window, Effects, Effect, EffectState } from "@tauri-apps/api/window";

export const isTransparentBack = ref(false)
export const platform = ref('')
const appWindow = new Window('main')
function makeEffects(): Effects {
    return {
        effects: [Effect.HudWindow, Effect.Mica, Effect.Acrylic],
        radius: 16,
        state: EffectState.Active,
        color: "#3232327f",
    } as Effects;
}


export async function setWindowTransparent(is: boolean) {
    if (is) {
        if (platform.value === 'macos')
            await invoke('set_window_transparent', { transparent: is })
        else
            await appWindow.clearEffects()
    } else {
        await appWindow.setEffects(makeEffects())
    }
    isTransparentBack.value = is
}


export function toggleWindowTransparent() {
    const to = !isTransparentBack.value
    setWindowTransparent(to).then(() => {
        logDebug(`[Window] isTransparent: ${isTransparentBack.value}`)
    }).catch ((err) => {
        logError(`[Window] 切换窗口透明失败: ${err}`)
    })

}