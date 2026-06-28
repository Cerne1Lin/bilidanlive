import { invoke } from "@tauri-apps/api/core";

/** 应用设置（与 Rust AppSettings 对应） */
export interface AppSettings {
  glassmorphism_background: boolean;
  font_size: number;
  auto_play: boolean;
  audio_only: boolean;
  theme: string;
  volume: number;
  auto_link_wss: boolean;
  color: string;
  log_level: string;
}

/** 获取所有设置 */
export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

/** 设置单个配置项，返回更新后的完整设置 */
export async function setSetting(
  key: keyof AppSettings,
  value: AppSettings[typeof key]
): Promise<AppSettings> {
  return invoke<AppSettings>("set_setting", { key, value });
}
