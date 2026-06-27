import { ref, Ref, watch } from "vue";
import { getSettings, setSetting } from "../utility/settings";
import type { AppSettings } from "../utility/settings";
import { error as logError, info as logInfo } from "../utility/logger";

// ── 设置项类型定义 ─────────────────────────────────
export interface SetItemRequire {
    key: keyof AppSettings;
    title: string;
    desc?: string;
    icon?: string;
    type: 'switch' | 'seg-slider' | 'slider';
    segments?: {
        label: string;
        value: number | string;
    }[];
    sliderMax?: number;
    sliderMin?: number;
    isDisable?: boolean;
    toggleValue?: Ref<boolean>;
    sliderValue?: Ref<number | string>;
}

// ── 响应式 ref（独立声明） ──────────────────────────
const glassmorphismBackground = ref<boolean>(true);
const fontSize = ref<number>(16);
const autoPlay = ref<boolean>(true);
const audioOnly = ref<boolean>(false);
const darktheme = ref<boolean>(true);
const volume = ref<number>(50);
const autoLinkWss = ref<boolean>(true);
const color = ref<string>("pink");
const logLevel = ref<string>("error");

export const playSettingItems: SetItemRequire[] = [
    {
        key: "auto_play",
        title: "自动播放",
        desc: "进入直播间时自动开始播放",
        type: "switch",
        toggleValue: autoPlay
    },
    {
        key: "audio_only",
        title: "仅音频模式",
        desc: "开启后只播放音频，关闭则同时播放视频",
        type: "switch",
        toggleValue: audioOnly,
    },
    {
        key: "auto_link_wss",
        title: "自动连接 WSS",
        desc: "打开直播间时自动连接弹幕服务器",
        type: "switch",
        toggleValue: autoLinkWss,
    },

]
// ── 设置项数组（只引用 ref，不内联创建） ────────────
export const themeSettingItems: SetItemRequire[] = [
    {
        key: "glassmorphism_background",
        title: "毛玻璃背景",
        desc: "窗口背景毛玻璃效果",
        type: "switch",
        toggleValue: glassmorphismBackground,
    },
    {
        key: "font_size",
        title: "弹幕字体大小",
        type: "seg-slider",
        sliderValue: fontSize,
        segments: [
            { label: '0.5x', value: 8 },
            { label: '0.75x', value: 12 },
            { label: '1x', value: 16 },
            { label: '1.25x', value: 20 },
            { label: '1.5x', value: 24 },
        ],
    },
    {
        key: "dark_theme",
        title: "启用暗色模式",
        desc: "关闭时建议关闭毛玻璃",
        type: "switch",
        toggleValue: darktheme
    },
];

export const otherSettingItems: SetItemRequire[] = [
    {
        key: "log_level",
        title: "日志级别",
        desc: "控制日志详细程度，TRACE(最详细) → ERROR(仅错误)",
        type: "seg-slider",
        sliderValue: logLevel,
        segments: [
            { label: 'TRACE', value: 'trace' },
            { label: 'DEBUG', value: 'debug' },
            { label: 'INFO',  value: 'info' },
            { label: 'WARN',  value: 'warn' },
            { label: 'ERROR', value: 'error' },
        ],
    },
]
export const settingItems = new Map<string, SetItemRequire[]>()
settingItems.set('play', playSettingItems)
settingItems.set('theme', themeSettingItems)
settingItems.set('others', otherSettingItems)

// ── 自动持久化 ────────────────────────────────────

let initialized = false;
const pendingUpdates = new Map<keyof AppSettings, ReturnType<typeof setTimeout>>();

/** 对每个设置 ref 建立 watch，值变化时自动调用 updateSetting */
export function setupAutoSave(): void {
    for (const [_, v] of settingItems) {
        for (const item of v) {
            const target = item.toggleValue ?? item.sliderValue;
            if (!target) continue;
            watch(target, (val) => {
                if (!initialized) return;
                // 防抖：取消上一次未发出的更新
                const prev = pendingUpdates.get(item.key);
                if (prev) clearTimeout(prev);
                // switch 立即生效，slider 延迟 200ms 避免拖拽时频繁写入
                const delay = item.type === "switch" ? 0 : 200;
                pendingUpdates.set(item.key, setTimeout(() => {
                    pendingUpdates.delete(item.key);
                    updateSetting(item.key, val as any);
                }, delay));
            });
        }
    }
    // volume 不在 settingItems 中（不在设置页展示），但需要持久化
    watch(volume, (val) => {
        if (!initialized) return;
        const prev = pendingUpdates.get("volume");
        if (prev) clearTimeout(prev);
        pendingUpdates.set("volume", setTimeout(() => {
            pendingUpdates.delete("volume");
            updateSetting("volume", val);
        }, 200));
    });
    watch(color, (val) => {
        if (!initialized) return;
        const prev = pendingUpdates.get("color");
        if (prev) clearTimeout(prev)
        pendingUpdates.set("color", setTimeout(() => {
            pendingUpdates.delete("color")
            updateSetting("color", val);
        }, 200))
    })
}

// ── API ─────────────────────────────────────────────

/** 启动时调用：从 Rust 读取所有设置并同步到 ref */
export async function initSettings(): Promise<void> {
    try {
        const s = await getSettings();
        volume.value = s.volume
        color.value = s.color
        for (const [_, v] of settingItems) {
            for (const item of v) {
                const val = s[item.key];
                if (item.toggleValue !== undefined) {
                    item.toggleValue.value = val as boolean;
                } else if (item.sliderValue !== undefined) {
                    item.sliderValue.value = val as string | number;
                }
            }
        }
        initialized = true;
        logInfo("[Setting] 设置已初始化");
    } catch (err) {
        logError(`[Setting] 初始化设置失败: ${err}`);
        console.error("[Setting] 初始化设置失败:", err);
    }
}

/** 修改单个设置项（调用 Rust 持久化 + 同步本地 ref） */
export async function updateSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
    try {
        const updated = await setSetting(key, value);
        for (const [_, v] of settingItems) {
            const item = v.find((e) => e.key === key);
            if (item) {
                const val = updated[key];
                if (item.toggleValue !== undefined) {
                    item.toggleValue.value = val as boolean;
                } else if (item.sliderValue !== undefined) {
                    item.sliderValue.value = val as string | number;
                }
                break
            }
        }
    } catch (err) {
        logError(`[Setting] 更新 ${key} 失败: ${err}`);
        console.error(`[Setting] 更新 ${key} 失败:`, err);
        throw err;
    }
}

export default {
    glassmorphismBackground,
    fontSize,
    autoPlay,
    audioOnly,
    darktheme,
    volume,
    autoLinkWss,
    color,
    logLevel,
}