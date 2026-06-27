use std::collections::HashMap;
use std::fmt::Write as FmtWrite;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use log::{debug, info, warn};
use md5::Digest;
use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_http::reqwest;

// ── 盐值映射表（固定，全站共用） ──────────────────────────

const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

// ── 持久化缓存结构 ─────────────────────────────────────

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct WbiKeyCache {
    img_key: String,
    sub_key: String,
    /// 上次刷新时的北京时间日期 "YYYY-MM-DD"
    beijing_date: String,
}

/// 托管状态：在线程间共享
pub struct WbiState {
    cache: Mutex<Option<WbiKeyCache>>,
    cache_path: PathBuf,
}

// ── nav 接口响应（只取需要的字段） ──────────────────────

#[derive(Deserialize)]
struct NavWbiImg {
    img_url: String,
    sub_url: String,
}

#[derive(Deserialize)]
struct NavData {
    wbi_img: NavWbiImg,
}

#[derive(Deserialize)]
struct NavRes {
    // code: i32,     // 可不声明，不关心
    data: Option<NavData>,
}

// ── 内部辅助 ──────────────────────────────────────────

/// 从 img_url / sub_url 的文件名提取 key
/// 示例: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png"
///   → "7cd084941338484aae1ad9425b84077c"
fn extract_key_from_url(url: &str) -> Result<String, String> {
    // 取最后一个 '/' 之后的部分，再剥掉 ".png"
    let file = url.rsplit('/').next().unwrap_or("");
    let key = file.strip_suffix(".png").unwrap_or(file);
    if key.len() == 32 && key.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(key.to_owned())
    } else {
        Err(format!("非法的 wbi key: {}", key))
    }
}

/// 计算 mixin_key：sub 拼接到 img 后面 → 按映射表重排 → 取前 32 位
fn compute_mixin_key(img_key: &str, sub_key: &str) -> String {
    let raw: Vec<char> = format!("{}{}", img_key, sub_key).chars().collect();
    MIXIN_KEY_ENC_TAB
        .iter()
        .take(32)
        .map(|&i| raw.get(i).copied().unwrap_or_default())
        .collect()
}

/// 获取北京时间今天的日期字符串 "YYYY-MM-DD"
fn beijing_date_now() -> String {
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    // UTC+8
    let beijing_secs = now_secs + 8 * 3600;
    let total_days = beijing_secs / 86400;

    // 从 Unix epoch (1970-01-01) 起算年月日（简单算法）
    let (y, m, d) = days_to_ymd(total_days as i64);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// 将 Unix epoch 以来的天数转为公历日期
fn days_to_ymd(mut days: i64) -> (i64, u32, u32) {
    // 400年周期 = 146097 天
    days += 719468; // 偏移到 0000-03-01
    let era = if days >= 0 { days } else { days - 146096 } / 146097;
    let doe = days - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32, d as u32)
}

/// 请求 nav 接口，获取并缓存 wbi 密钥
async fn fetch_and_cache(app_handle: &tauri::AppHandle) -> Result<WbiKeyCache, String> {
    let res = reqwest::get("https://api.bilibili.com/x/web-interface/nav")
        .await
        .map_err(|e| format!("获取 nav 失败: {}", e))?
        .json::<NavRes>()
        .await
        .map_err(|e| format!("解析 nav 响应失败: {}", e))?;

    let data = res.data.ok_or("nav 接口返回空 data".to_string())?;
    let img_key = extract_key_from_url(&data.wbi_img.img_url)?;
    let sub_key = extract_key_from_url(&data.wbi_img.sub_url)?;

    let beijing_date = beijing_date_now();
    let cache = WbiKeyCache {
        img_key,
        sub_key,
        beijing_date,
    };

    // 持久化到磁盘
    let state = app_handle.state::<WbiState>();
    if let Some(parent) = state.cache_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = std::fs::write(&state.cache_path, json);
    }

    Ok(cache)
}

/// 获取当前有效的 mixin_key（必要时自动刷新）
pub async fn get_mixin_key(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let state = app_handle.state::<WbiState>();
    let today = beijing_date_now();

    // 先检查内存缓存
    {
        let cache = state.cache.lock().unwrap();
        if let Some(ref c) = *cache {
            if c.beijing_date == today {
                debug!("[wbi] mixin_key 来源: 内存缓存");
                return Ok(compute_mixin_key(&c.img_key, &c.sub_key));
            }
        }
    }

    // 尝试从磁盘恢复
    {
        if let Ok(json) = std::fs::read_to_string(&state.cache_path) {
            if let Ok(disk_cache) = serde_json::from_str::<WbiKeyCache>(&json) {
                if disk_cache.beijing_date == today {
                    let mixin = compute_mixin_key(&disk_cache.img_key, &disk_cache.sub_key);
                    let mut cache = state.cache.lock().unwrap();
                    *cache = Some(disk_cache);
                    debug!("[wbi] mixin_key 来源: 磁盘缓存");
                    return Ok(mixin);
                }
            }
        }
    }

    // 需要重新拉取
    debug!("[wbi] mixin_key 来源: 网络拉取");
    let cache = fetch_and_cache(app_handle).await?;
    let mixin = compute_mixin_key(&cache.img_key, &cache.sub_key);
    let mut guard = state.cache.lock().unwrap();
    *guard = Some(cache);

    Ok(mixin)
}

// ── URL 编码（WBI 特殊规则） ────────────────────────────

/// 规则:
///  - 过滤掉值中的 !'()* 四个字符
///  - 空格编码为 %20
///  - 百分号编码字母大写
///  - 保留 A-Z a-z 0-9 - _ . ~ 不编码
fn wbi_encode(s: &str) -> String {
    // 先过滤 !'()*
    let filtered: String = s
        .chars()
        .filter(|c| !matches!(c, '!' | '\'' | '(' | ')' | '*'))
        .collect();

    let mut out = String::with_capacity(filtered.len() * 3);
    for byte in filtered.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push_str("%20"),
            _ => {
                write!(out, "%{:02X}", byte).unwrap();
            }
        }
    }
    out
}

/// 核心签名：给定参数 + mixin_key → 返回 w_rid 和 wts
pub fn sign_params(params: &HashMap<String, String>, mixin_key: &str) -> (String, String) {
    let wts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string();

    // 1. 收集所有参数（含 wts），按键名升序排序
    let wts_key = "wts".to_string();
    let mut sorted: Vec<(&String, &String)> = params
        .iter()
        .chain(std::iter::once((&wts_key, &wts)))
        .collect();
    sorted.sort_by_key(|(k, _)| *k);

    // 2. 拼接 query string: key=value&key=value...
    let mut payload = String::new();
    for (k, v) in &sorted {
        if !payload.is_empty() {
            payload.push('&');
        }
        payload.push_str(&wbi_encode(k));
        payload.push('=');
        payload.push_str(&wbi_encode(v));
    }

    // 3. 追加 mixin_key
    payload.push_str(mixin_key);

    // 4. MD5 → w_rid
    let digest = md5::Md5::digest(payload.as_bytes());
    let w_rid = format!("{:02x}", digest); // 小写 hex（md5 标准）

    (w_rid, wts)
}

// ── Tauri 命令 ─────────────────────────────────────────

/// 前端调用：传入请求参数，返回签名后的完整参数（含 w_rid 和 wts）
#[tauri::command]
pub async fn wbi_sign_params(
    params: HashMap<String, String>,
    app_handle: tauri::AppHandle,
) -> Result<HashMap<String, String>, String> {
    let mixin_key = get_mixin_key(&app_handle).await?;
    let (w_rid, wts) = sign_params(&params, &mixin_key);

    let mut signed = params;
    signed.insert("w_rid".to_string(), w_rid);
    signed.insert("wts".to_string(), wts);
    Ok(signed)
}

/// 供 lib.rs setup 调用：应用启动时预热密钥
pub async fn warmup_keys(app_handle: &tauri::AppHandle) {
    match get_mixin_key(app_handle).await {
        Ok(key) => info!("[wbi] 密钥就绪: {}...", &key[..8]),
        Err(e) => warn!("[wbi] 预热失败: {}", e),
    }
}

/// 构建 WbiState 并注册到 Tauri
pub fn init_state(app_handle: &tauri::AppHandle) {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .expect("failed to resolve app_data_dir");
    let cache_path = data_dir.join("wbi_cache.json");

    let state = WbiState {
        cache: Mutex::new(None),
        cache_path,
    };

    app_handle.manage(state);
}
