use std::fs;
use tauri::AppHandle;
use tauri::Manager;
use log::LevelFilter;

/// 动态修改日志级别并持久化到 store
#[tauri::command]
pub fn set_log_level(app_handle: AppHandle, level: String) -> Result<String, String> {
    let filter: LevelFilter = match level.to_lowercase().as_str() {
        "trace" => LevelFilter::Trace,
        "debug" => LevelFilter::Debug,
        "info" => LevelFilter::Info,
        "warn" => LevelFilter::Warn,
        "error" => LevelFilter::Error,
        "off" => LevelFilter::Off,
        _ => {
            return Err(format!(
                "无效的日志级别: {level}。有效值: trace, debug, info, warn, error, off"
            ))
        }
    };

    // Rust 端 log 宏过滤
    log::set_max_level(filter);
    // webview 端日志过滤（绕过 log 宏，走 Target::filter）
    crate::RUNTIME_LOG_LEVEL.store(filter as usize, std::sync::atomic::Ordering::Relaxed);

    // 持久化到 settings store
    crate::settings::set_setting(
        app_handle.clone(),
        "log_level".into(),
        serde_json::Value::String(level.to_lowercase()),
    )
    .map_err(|e| format!("持久化日志级别失败: {e}"))?;

    Ok(format!("日志级别已设置为 {}", level.to_lowercase()))
}

/// 获取所有日志文件的总大小（字节）
#[tauri::command]
pub fn get_log_file_size(app_handle: AppHandle) -> Result<u64, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("无法获取日志目录: {e}"))?;

    let mut total = 0u64;
    if log_dir.exists() {
        let entries =
            fs::read_dir(&log_dir).map_err(|e| format!("读取日志目录失败: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("目录项错误: {e}"))?;
            if entry.path().is_file() {
                total += entry
                    .metadata()
                    .map_err(|e| format!("读取文件信息失败: {e}"))?
                    .len();
            }
        }
    }
    Ok(total)
}

/// 清理所有日志文件
#[tauri::command]
pub fn clean_log_files(app_handle: AppHandle) -> Result<String, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("无法获取日志目录: {e}"))?;

    let mut removed = 0u32;
    let mut errors = Vec::new();

    if log_dir.exists() {
        match fs::read_dir(&log_dir) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => {
                            let path = entry.path();
                            if path.is_file() {
                                if let Err(e) = fs::remove_file(&path) {
                                    errors.push(format!("{}: {e}", path.display()));
                                } else {
                                    removed += 1;
                                }
                            }
                        }
                        Err(e) => errors.push(format!("read_dir entry error: {e}")),
                    }
                }
            }
            Err(e) => return Err(format!("读取日志目录失败: {e}")),
        }
    }

    if !errors.is_empty() {
        return Err(format!("部分删除失败: {}", errors.join("; ")));
    }

    Ok(format!("已删除 {removed} 个日志文件"))
}
