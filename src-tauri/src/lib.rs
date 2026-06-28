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

            // ========== Rounded corners (macOS) ==========
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                use objc2::msg_send;
                use objc2_app_kit::NSWindow;

                let ns_window_ptr = window.ns_window().expect("Get ns_window error");
                let ns_window: &NSWindow = unsafe { &*ns_window_ptr.cast() };
                let content_view = ns_window
                    .contentView()
                    .expect("window should have contentView");

                unsafe {
                    // Make contentView layer-backed and clip to rounded bounds
                    let content_ref = &*content_view;
                    let _: () = msg_send![content_ref, setWantsLayer: true];
                    let content_layer: *mut objc2::runtime::AnyObject =
                        msg_send![content_ref, layer];
                    let _: () = msg_send![content_layer, setCornerRadius: 16.0f64];
                    let _: () = msg_send![content_layer, setMasksToBounds: true];

                    // Also clip the WKWebView layer so web content respects corners
                    let ns_view_ptr = window.ns_view().expect("Get ns_view error");
                    let ns_view: *mut objc2::runtime::AnyObject = ns_view_ptr as *mut _;
                    let _: () = msg_send![ns_view, setWantsLayer: true];
                    let webview_layer: *mut objc2::runtime::AnyObject = msg_send![ns_view, layer];
                    let _: () = msg_send![webview_layer, setCornerRadius: 16.0f64];
                    let _: () = msg_send![webview_layer, setMasksToBounds: true];
                }
            }

            // ========== Rounded corners (Windows) ==========
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                use windows::Win32::Foundation::HWND;
                use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
                use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

                let hwnd = window.hwnd().expect("Get hwnd error");
                let hwnd_ptr = hwnd.0; // *mut c_void

                unsafe fn apply_rounded(hwnd: HWND, radius: i32) {
                    let mut rect = std::mem::zeroed();
                    let _ = GetClientRect(hwnd, &mut rect);
                    let w = rect.right - rect.left;
                    let h = rect.bottom - rect.top;
                    if w > 0 && h > 0 {
                        let rgn = CreateRoundRectRgn(0, 0, w, h, radius, radius);
                        let _ = SetWindowRgn(hwnd, Some(rgn), true);
                    }
                }

                unsafe {
                    apply_rounded(hwnd, 16);
                }

                // 窗口大小改变时重新裁剪
                // HWND 不是 Send，无法被 move 闭包捕获，转为 isize 传递
                let hwnd_isize = hwnd_ptr as isize;
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Resized(_) = event {
                        unsafe {
                            apply_rounded(HWND(hwnd_isize as *mut core::ffi::c_void), 16);
                        }
                    }
                });
            }

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
