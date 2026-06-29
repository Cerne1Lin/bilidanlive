import { invoke } from "@tauri-apps/api/core";
import { ref, Ref, watchEffect } from "vue";
import { error as logError, debug as logDebug } from "../utility/logger";
import { Window, Effects, Effect, EffectState } from "@tauri-apps/api/window";
import { darkTheme } from "./Theme";

export const isTransparentBack = ref(false);
export const platform = ref("");
const appWindow = new Window("main");
function makeEffects(dark: boolean | null): Effects {
    return {
        effects: [Effect.HudWindow, Effect.Acrylic],
        radius: 16,
        state: EffectState.Active,
        color: dark ? "#32323254" : "#e2e2e254",
    } as Effects;
}

export function setEffects(dark: Ref<boolean>) {
    if (platform.value !== "windows") return;
    watchEffect(() => {
        if (!isTransparentBack.value)
            appWindow
                .setEffects(makeEffects(dark.value))
                .catch((err) => logError(`[Window] 设置effects失败 ${err}`));
    });
}

export async function setWindowTransparent(is: boolean) {
    if (is) {
        if (platform.value === "macos")
            await invoke("set_window_transparent", { transparent: is });
        else await appWindow.clearEffects();
    } else {
        await appWindow.setEffects(makeEffects(darkTheme.value));
    }
    isTransparentBack.value = is;
}

export function toggleWindowTransparent() {
    const to = !isTransparentBack.value;
    setWindowTransparent(to)
        .then(() => {
            logDebug(`[Window] isTransparent: ${isTransparentBack.value}`);
        })
        .catch((err) => {
            logError(`[Window] 切换窗口透明失败: ${err}`);
        });
}
