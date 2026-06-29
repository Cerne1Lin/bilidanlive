import { computed, ref } from "vue";
import settings from "./Setting";
import { isTransparentBack } from "./WindowControl";

let mediaQuery: MediaQueryList | null = null;
const isDark = ref(false);

const update = (e: MediaQueryListEvent) => {
    isDark.value = e.matches;
};

const start = () => {
    if (!window.matchMedia) return;
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    isDark.value = mediaQuery.matches;
    mediaQuery.addEventListener("change", update);
};

const stop = () => {
    if (mediaQuery) {
        mediaQuery.removeEventListener("change", update);
    }
};

export function useSystemTheme() {
    return {
        isDark,
        start,
        stop,
    };
}

export interface ThemeColors {
    label: string;
    name: string;
    lightest: string;
    light: string;
    medium: string;
    dark: string;
    darkest: string;
}

export const THEMES: Record<string, ThemeColors> = {
    pink: {
        label: "pink",
        name: "拂晓粉",
        lightest: "#fad1e5",
        light: "#f7aed1",
        medium: "#ee519c",
        dark: "#c61369",
        darkest: "#59092e",
    },
    blue: {
        label: "blue",
        name: "晴空蓝",
        lightest: "#d4e9f7",
        light: "#8bc4ea",
        medium: "#3498db",
        dark: "#196090",
        darkest: "#0a2639",
    },
    purple: {
        label: "purple",
        name: "星穹紫",
        lightest: "#d8d4f7",
        light: "#b1a9f0",
        medium: "#6252e1",
        dark: "#2e1eaf",
        darkest: "#120c42",
    },
    green: {
        label: "green",
        name: "薄荷绿",
        lightest: "#bffec8",
        light: "#63cf85",
        medium: "#20ad70",
        dark: "#105723",
        darkest: "#082b09",
    },
    yellow: {
        label: "yellow",
        name: "竞速黄",
        lightest: "#fbf1d0",
        light: "#eac95e",
        medium: "#d3a91f",
        dark: "#b18b0e",
        darkest: "#4a3a03",
    },
    red: {
        label: "red",
        name: "赤霞红",
        lightest: "#ffcccc",
        light: "#ffbaba",
        medium: "#ff5454",
        dark: "#ed0000",
        darkest: "#500101",
    },
};

export const DEFAULT_THEME = THEMES.pink;

// ── 当前主题（响应式派生） ──────────────────────────────

/** 由 Setting.ts 中的 theme ref 驱动，自动推导当前主题色 */
export const currentTheme = computed<ThemeColors>(() => {
    return THEMES[settings.color.value] ?? DEFAULT_THEME;
});

export const glassmorphismBackground = ref(
    settings.glassmorphismBackground.value,
);
// ── 便捷 computed ───────────────────────────────────────
export const darkTheme = computed(() => {
    if (settings.theme.value === "dark") return true;
    if (settings.theme.value === "system") return isDark.value;
    return false;
});
export const lightColor = computed(() => currentTheme.value.light);
export const lightestColor = computed(() => currentTheme.value.lightest);
export const mediumColor = computed(() => currentTheme.value.medium);
export const darkColor = computed(() => currentTheme.value.dark);
export const darkestColor = computed(() => currentTheme.value.darkest);
export const hlColor = computed(() => {
    if (darkTheme.value) return "white";
    else return "black";
});
export const bgLightColor = computed(() => {
    if (settings.glassmorphismBackground.value || isTransparentBack.value)
        return "transparent";
    if (darkTheme.value) return "#252525";
    else return lightestColor.value;
});
export const bgDarkColor = computed(() => {
    if (settings.glassmorphismBackground.value || isTransparentBack.value)
        return "transparent";
    if (darkTheme.value) return "black";
    else return darkestColor.value;
});
export const accentColor = computed(() => {
    return lightColor.value;
});

export const docBgColor = computed(() => {
    if (isTransparentBack.value || settings.glassmorphismBackground.value) {
        return "transparent";
    } else {
        return bgLightColor.value;
    }
});

export const radius = ref<string>("8px");
