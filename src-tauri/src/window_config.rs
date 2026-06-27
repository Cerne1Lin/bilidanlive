use tauri::Manager;

/// 切换窗口透明模式
///
/// - `transparent = true`：纯透明（可清晰看到桌面）
/// - `transparent = false`：毛玻璃（HUDWindow 模糊效果）
#[tauri::command]
pub fn set_window_transparent(
    transparent: bool,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let window = app_handle.get_webview_window("main").ok_or("找不到窗口")?;

    #[cfg(target_os = "macos")]
    {
        set_window_transparent_macos(&window, transparent)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let color = if transparent {
            None
        } else {
            Some(tauri::window::Color(0, 0, 0, 255))
        };
        window
            .set_background_color(color)
            .map_err(|e| format!("设置窗口背景失败: {}", e))?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_window_transparent_macos(
    window: &tauri::WebviewWindow,
    transparent: bool,
) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowOrderingMode,
    };

    let mtm = MainThreadMarker::new().ok_or("必须在主线程上调用")?;

    let ns_window_ptr = window
        .ns_window()
        .map_err(|e| format!("获取 NSWindow 失败: {}", e))?;
    let ns_window: &NSWindow = unsafe { &*ns_window_ptr.cast() };
    let content_view = ns_window.contentView().ok_or("无法获取 contentView")?;

    unsafe {
        // NSWindow 始终透明
        let _: () = msg_send![ns_window, setOpaque: false];
        let clear_color: *mut objc2::runtime::AnyObject =
            msg_send![objc2::class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: clear_color];

        // WKWebView 始终不绘制背景
        set_webview_draws_background(&content_view, false);

        if transparent {
            // 纯透明：隐藏毛玻璃
            let existing = find_visual_effect_view(&content_view);
            if !existing.is_null() {
                let _: () = msg_send![existing, setHidden: true];
            }
        } else {
            // 毛玻璃：创建或显示
            let existing = find_visual_effect_view(&content_view);
            if existing.is_null() {
                let bounds = content_view.bounds();
                let effect_view =
                    NSVisualEffectView::initWithFrame(mtm.alloc::<NSVisualEffectView>(), bounds);
                effect_view.setMaterial(NSVisualEffectMaterial::HUDWindow);
                effect_view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
                effect_view.setState(NSVisualEffectState::Active);
                effect_view.setAutoresizingMask(
                    NSAutoresizingMaskOptions::ViewWidthSizable
                        | NSAutoresizingMaskOptions::ViewHeightSizable,
                );
                content_view.addSubview_positioned_relativeTo(
                    &effect_view,
                    NSWindowOrderingMode::Below,
                    None,
                );
            } else {
                let _: () = msg_send![existing, setHidden: false];
            }
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
unsafe fn find_visual_effect_view(
    content_view: &objc2_app_kit::NSView,
) -> *mut objc2::runtime::AnyObject {
    use objc2::msg_send;

    let subviews: *mut objc2::runtime::AnyObject = msg_send![content_view, subviews];
    let count: isize = msg_send![subviews, count];
    for i in 0..count {
        let subview: *mut objc2::runtime::AnyObject = msg_send![subviews, objectAtIndex: i];
        let is_effect: bool = msg_send![subview, isKindOfClass: objc2::class!(NSVisualEffectView)];
        if is_effect {
            return subview;
        }
    }
    std::ptr::null_mut()
}

#[cfg(target_os = "macos")]
unsafe fn set_webview_draws_background(view: &objc2_app_kit::NSView, draws: bool) {
    let view_ptr = (view as *const objc2_app_kit::NSView) as *mut objc2::runtime::AnyObject;
    set_webview_draws_background_raw(view_ptr, draws);
}

#[cfg(target_os = "macos")]
unsafe fn set_webview_draws_background_raw(view: *mut objc2::runtime::AnyObject, draws: bool) {
    use objc2::msg_send;

    let is_wkwebview: bool = msg_send![view, isKindOfClass: objc2::class!(WKWebView)];
    if is_wkwebview {
        let number: *mut objc2::runtime::AnyObject =
            msg_send![objc2::class!(NSNumber), numberWithBool: draws];
        let key: *mut objc2::runtime::AnyObject = msg_send![
            objc2::class!(NSString),
            stringWithUTF8String: b"drawsBackground\0".as_ptr() as *const i8
        ];
        let _: () = msg_send![view, setValue: number, forKey: key];
        return;
    }

    let subviews: *mut objc2::runtime::AnyObject = msg_send![view, subviews];
    let count: isize = msg_send![subviews, count];
    for i in 0..count {
        let subview: *mut objc2::runtime::AnyObject = msg_send![subviews, objectAtIndex: i];
        set_webview_draws_background_raw(subview, draws);
    }
}
