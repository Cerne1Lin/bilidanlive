use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use log::{debug, info};
use serde::{Deserialize, Serialize};

/// cookies + refresh_token 的完整持久化结构
#[derive(Serialize, Deserialize, Clone)]
pub struct AuthData {
    pub cookies: HashMap<String, String>,
    pub refresh_token: String,
}

/// 全局 cookie 状态，由 Tauri 托管
pub struct CookieStore {
    pub auth: Mutex<Option<AuthData>>,
    file_path: PathBuf,
}

impl CookieStore {
    /// 从 app_data_dir 创建实例，若磁盘有缓存则恢复
    pub fn from_app_data(mut data_dir: PathBuf) -> Self {
        data_dir.push("auth.json");
        let auth = if data_dir.exists() {
            fs::read_to_string(&data_dir)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
        } else {
            None
        };
        info!(
            "[auth] 从磁盘恢复 cookie 缓存{}",
            if auth.is_some() { " (已登录)" } else { " (未登录)" }
        );
        CookieStore {
            auth: Mutex::new(auth),
            file_path: data_dir,
        }
    }

    /// 更新内存中的 auth 并写入文件
    pub fn set(&self, auth: AuthData) -> Result<(), String> {
        self.flush(Some(&auth))?;
        {
            let mut guard = self.auth.lock().map_err(|e| e.to_string())?;
            *guard = Some(auth);
        }
        debug!("[auth] cookie 已保存到磁盘");
        Ok(())
    }

    /// 清除内存中的 auth 并删除磁盘文件
    pub fn clear(&self) -> Result<(), String> {
        {
            let mut guard = self.auth.lock().map_err(|e| e.to_string())?;
            *guard = None;
        }
        if self.file_path.exists() {
            fs::remove_file(&self.file_path).map_err(|e| e.to_string())?;
        }
        info!("[auth] cookie 已清除");
        Ok(())
    }

    /// 将当前 auth 持久化到磁盘
    fn flush(&self, auth: Option<&AuthData>) -> Result<(), String> {
        if let Some(auth) = auth {
            if let Some(parent) = self.file_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let json = serde_json::to_string(auth).map_err(|e| e.to_string())?;
            fs::write(&self.file_path, json).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
