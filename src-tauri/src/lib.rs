mod cookie_store;
mod image_cache;
mod live_audio;
mod live_ws;
mod logger;
mod models;
mod settings;
mod utils;
mod wbi_sign;
mod web_client;
mod window_config;

use cookie_store::CookieStore;
use image_cache::ImageCache;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::Manager;

/// 运行时日志级别：Target::filter 动态读取，解决 webview 日志
/// 绕过 log::set_max_level 的问题（它们直接调 log::logger().log()）
pub static RUNTIME_LOG_LEVEL: AtomicUsize =
    AtomicUsize::new(log::LevelFilter::Error as usize);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 最早防线：在 fern 安装前就拦住 Rust 端 log 宏
    log::set_max_level(log::LevelFilter::Error);

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin({
            use tauri_plugin_log::{Target, TargetKind, RotationStrategy};
            let mut targets = vec![
                Target::new(TargetKind::LogDir {
                    file_name: Some("app".into()),
                })
                .filter(|metadata| {
                    metadata.level() as usize
                        <= RUNTIME_LOG_LEVEL.load(Ordering::Relaxed)
                }),
            ];
            // 开发模式下同时输出到终端，生产模式仅写文件
            if cfg!(debug_assertions) {
                targets.push(
                    Target::new(TargetKind::Stdout)
                        .filter(|metadata| {
                            metadata.level() as usize
                                <= RUNTIME_LOG_LEVEL.load(Ordering::Relaxed)
                        }),
                );
            }
            tauri_plugin_log::Builder::new()
                // 不设 .level()，让 fern 本身不过滤，由 filter + log::set_max_level 控制
                .max_file_size(5 * 1024 * 1024_u128) // 5MB 单文件限制
                .rotation_strategy(RotationStrategy::KeepAll)
                .targets(targets)
                .build()
        })
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 初始化设置系统（优先级最高，最早执行）
            settings::init_settings(app.handle());

            // 启动时从 app_data_dir 恢复 cookie 缓存
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app_data_dir");
            log::debug!("[setup] data_dir = {}", data_dir.display());
            let cookie_store = CookieStore::from_app_data(data_dir.clone());
            app.manage(cookie_store);

            // 图片两级缓存：内存 1000 张 + 磁盘 50MB
            let img_cache_dir = data_dir.join("image_cache");
            app.manage(ImageCache::new(img_cache_dir, 1000, 100));

            // 直播间 WSS 连接状态
            app.manage(live_ws::LiveWsState::default());
            // 直播间音频/视频流状态
            app.manage(live_audio::LiveAudioState::default());

            // 初始化 WBI 签名状态
            wbi_sign::init_state(app.handle());

            // 预热 WBI 密钥
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                wbi_sign::warmup_keys(&handle).await;
            });

            // 应用持久化日志级别（在所有初始化完成后执行）
            apply_saved_log_level(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_setting,
            logger::set_log_level,
            logger::get_log_file_size,
            logger::clean_log_files,
            web_client::get_login_qrcode,
            web_client::check_qrcode_status,
            web_client::get_login_status,
            web_client::check_cookie,
            web_client::get_nav_user_info,
            web_client::get_following_lives,
            web_client::fetch_image_base64,
            web_client::clear_cookies,
            web_client::get_live_play_url,
            web_client::get_room_info,
            web_client::get_history_danmu,
            web_client::get_history_list,
            web_client::record_room_entry,
            window_config::set_window_transparent,
            window_config::get_platform,
            live_ws::connect_live_room,
            live_ws::disconnect_live_room,
            live_audio::prepare_audio_stream,
            live_audio::set_track_active,
            live_audio::stop_audio_stream,
            wbi_sign::wbi_sign_params,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 从持久化存储加载日志级别，同步更新 log::set_max_level 和 RUNTIME_LOG_LEVEL
fn apply_saved_log_level(app_handle: &tauri::AppHandle) {
    if let Ok(s) = settings::load_settings(app_handle) {
        let filter = match s.log_level.to_lowercase().as_str() {
            "trace" => log::LevelFilter::Trace,
            "debug" => log::LevelFilter::Debug,
            "info" => log::LevelFilter::Info,
            "warn" => log::LevelFilter::Warn,
            "error" => log::LevelFilter::Error,
            _ => log::LevelFilter::Error,
        };
        log::set_max_level(filter);
        RUNTIME_LOG_LEVEL.store(filter as usize, Ordering::Relaxed);
    }
}
