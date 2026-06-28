use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "app-settings";

/// 应用设置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    /// 非透明态下是否使用毛玻璃效果（false = 纯色背景）
    #[serde(default = "default_glassmorphism_background")]
    pub glassmorphism_background: bool,
    /// 弹幕字号
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    /// 窗口置顶
    #[serde(default)]
    pub always_on_top: bool,
    /// 进入直播间自动播放
    #[serde(default = "default_auto_play")]
    pub auto_play: bool,
    /// 仅音频模式（开启时不播放视频）
    #[serde(default = "default_audio_only")]
    pub audio_only: bool,
    /// 主题：light / dark
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_volume")]
    pub volume: u32,
    #[serde(default = "default_auto_link_wss")]
    pub auto_link_wss: bool,
    #[serde(default = "default_color")]
    pub color: String,
    /// 日志级别: "trace" | "debug" | "info" | "warn" | "error"
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

fn default_color() -> String {
    "pink".to_string()
}
fn default_log_level() -> String {
    "error".to_string()
}
fn default_auto_link_wss() -> bool {
    true
}
fn default_volume() -> u32 {
    50
}
fn default_glassmorphism_background() -> bool {
    true
}
fn default_font_size() -> u32 {
    16
}
fn default_auto_play() -> bool {
    true
}
fn default_audio_only() -> bool {
    false
}
fn default_theme() -> String {
    "system".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            glassmorphism_background: default_glassmorphism_background(),
            font_size: default_font_size(),
            always_on_top: false,
            auto_play: default_auto_play(),
            audio_only: default_audio_only(),
            theme: default_theme(),
            volume: default_volume(),
            auto_link_wss: default_auto_link_wss(),
            color: default_color(),
            log_level: default_log_level(),
        }
    }
}

/// 初始化设置：从 store 加载，如不存在则写入默认值
pub fn init_settings(app_handle: &AppHandle) {
    let store = app_handle
        .store(STORE_FILE)
        .expect("failed to create/open settings store");

    // 如果 store 中没有配置，写入默认值
    if store.get(STORE_KEY).is_none() {
        let defaults = AppSettings::default();
        store.set(
            STORE_KEY.to_string(),
            serde_json::to_value(&defaults).expect("failed to serialize default settings"),
        );
        store.save().expect("failed to save settings store");
        log::info!("[settings] 已创建默认配置文件");
    } else {
        log::info!("[settings] 已加载现有配置文件");
    }
}

/// 值域限定
const FONT_SIZE_MIN: u32 = 8;
const FONT_SIZE_MAX: u32 = 48;
const VOLUME_MIN: u32 = 0;
const VOLUME_MAX: u32 = 100;
const VALID_COLORS: &[&str] = &["pink", "blue", "purple", "green", "yellow", "red"];
const VALID_LOG_LEVELS: &[&str] = &["trace", "debug", "info", "warn", "error"];
const VALID_THEMES: &[&str] = &["system", "dark", "light"];

/// 校验并修正越界值，返回被重置的字段名列表
fn validate(settings: &mut AppSettings) -> Vec<&'static str> {
    let mut reset: Vec<&'static str> = Vec::new();

    if settings.font_size < FONT_SIZE_MIN || settings.font_size > FONT_SIZE_MAX {
        settings.font_size = default_font_size();
        reset.push("font_size");
    }
    if settings.volume < VOLUME_MIN || settings.volume > VOLUME_MAX {
        settings.volume = default_volume();
        reset.push("volume");
    }
    if !VALID_COLORS.contains(&settings.color.as_str()) {
        settings.color = default_color();
        reset.push("color")
    }
    if !VALID_LOG_LEVELS.contains(&settings.log_level.as_str()) {
        settings.log_level = default_log_level();
        reset.push("log_level");
    }
    if !VALID_THEMES.contains(&settings.theme.as_str()) {
        settings.theme = default_theme();
        reset.push("theme");
    }    if !reset.is_empty() {
        log::warn!("[settings] 越界值已重置为默认: {:?}", reset);
    }
    reset
}

/// 从 store 读取当前设置，自动校验并修正越界值
pub(crate) fn load_settings(app_handle: &AppHandle) -> Result<AppSettings, String> {
    let store = app_handle
        .store(STORE_FILE)
        .map_err(|e| format!("无法打开设置存储: {}", e))?;

    let value = store
        .get(STORE_KEY)
        .unwrap_or_else(|| serde_json::to_value(AppSettings::default()).unwrap());

    let mut settings: AppSettings =
        serde_json::from_value(value).map_err(|e| format!("解析设置失败: {}", e))?;

    log::debug!(
        "[settings] 已加载设置: font_size={}, dark_theme={}, log_level={}, color={}",
        settings.font_size,
        settings.theme,
        settings.log_level,
        settings.color
    );

    let invalid = validate(&mut settings);
    // 如果有字段被重置，写回 store
    if !invalid.is_empty() {
        store.set(
            STORE_KEY.to_string(),
            serde_json::to_value(&settings).expect("failed to serialize settings"),
        );
        store.save().expect("failed to save settings after validation");
    }

    Ok(settings)
}

/// 获取所有设置
#[tauri::command]
pub fn get_settings(app_handle: AppHandle) -> Result<AppSettings, String> {
    load_settings(&app_handle)
}

/// 设置单个配置项
///
/// `key` 为字段名（snake_case），`value` 为新的 JSON 值。
/// 返回更新后的完整设置。
#[tauri::command]
pub fn set_setting(
    app_handle: AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<AppSettings, String> {
    let mut settings = load_settings(&app_handle)?;

    // 根据 key 名称匹配并更新对应字段
    match key.as_str() {
        "glassmorphism_background" => {
            settings.glassmorphism_background = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "font_size" => {
            settings.font_size = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "always_on_top" => {
            settings.always_on_top = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "auto_play" => {
            settings.auto_play = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "audio_only" => {
            settings.audio_only = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "dark_theme" => {
            settings.theme = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "volume" => {
            settings.volume = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "auto_link_wss" => {
            settings.auto_link_wss = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "color" => {
            settings.color = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        "log_level" => {
            settings.log_level = serde_json::from_value(value)
                .map_err(|e| format!("值类型错误: {}", e))?;
        }
        _ => return Err(format!("未知的设置项: {}", key)),
    }

    // 校验修改后的值
    let invalid = validate(&mut settings);
    if !invalid.is_empty() {
        return Err(format!("值超出允许范围: {:?}", invalid));
    }

    // 如果修改的是日志级别，立即生效
    if key == "log_level" {
        let filter = match settings.log_level.as_str() {
            "trace" => log::LevelFilter::Trace,
            "debug" => log::LevelFilter::Debug,
            "info" => log::LevelFilter::Info,
            "warn" => log::LevelFilter::Warn,
            "error" => log::LevelFilter::Error,
            _ => log::LevelFilter::Error,
        };
        // Rust 端 log 宏过滤
        log::set_max_level(filter);
        // webview 端过滤（绕过 log 宏，走 Target::filter）
        crate::RUNTIME_LOG_LEVEL.store(filter as usize, std::sync::atomic::Ordering::Relaxed);
    }

    // 写回 store 并持久化
    let store = app_handle
        .store(STORE_FILE)
        .map_err(|e| format!("无法打开设置存储: {}", e))?;

    store.set(
        STORE_KEY.to_string(),
        serde_json::to_value(&settings).map_err(|e| format!("序列化设置失败: {}", e))?,
    );

    store.save().map_err(|e| format!("保存设置失败: {}", e))?;

    Ok(settings)
}
