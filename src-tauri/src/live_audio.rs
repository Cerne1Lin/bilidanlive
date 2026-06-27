use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use futures_util::StreamExt;
use log::{debug, info, warn};
use tauri::ipc::Channel;
use tauri::State;
use tauri_plugin_http::reqwest;

use crate::cookie_store::{AuthData, CookieStore};
use crate::web_client;

// ── 状态管理（参考 live_ws::LiveWsState）──────────────

struct Inner {
    room_id: u64,
    stream_channel: Channel<Vec<u8>>,
    abort: Arc<AtomicBool>, // true = 继续运行
    notify: Arc<tokio::sync::Notify>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub struct LiveAudioState {
    inner: Mutex<Option<Inner>>,
    /// 前端是否在播放音频
    audio_active: AtomicBool,
    /// 前端是否在播放视频
    video_active: AtomicBool,
}

impl Default for LiveAudioState {
    fn default() -> Self {
        LiveAudioState {
            inner: Mutex::new(None),
            audio_active: AtomicBool::new(false),
            video_active: AtomicBool::new(false),
        }
    }
}

impl LiveAudioState {
    /// 当前是否应该拉流
    fn should_pull(&self) -> bool {
        self.audio_active.load(Ordering::Relaxed) || self.video_active.load(Ordering::Relaxed)
    }

    /// 通知后台任务状态已变更
    fn notify(&self) {
        if let Some(ref inner) = *self.inner.lock().unwrap() {
            inner.notify.notify_one();
        }
    }

    /// 停止拉流任务（保留 Channel 和 room_id）
    async fn abort_task(&self) {
        // 先发信号
        {
            let guard = self.inner.lock().unwrap();
            if let Some(ref inner) = guard.as_ref() {
                inner.abort.store(false, Ordering::Relaxed);
                inner.notify.notify_one();
            }
        }
        // 再取出并等待 task
        let handle = {
            let mut guard = self.inner.lock().unwrap();
            guard.as_mut().and_then(|inner| inner.task.take())
        };
        if let Some(h) = handle {
            let _ = h.await;
        }
    }

    /// 完全清理（释放 Channel）
    async fn ensure_disconnected(&self) {
        self.abort_task().await;
        *self.inner.lock().unwrap() = None;
    }

    /// 尝试启动拉流任务（如果 should_pull && 当前未在拉流）
    fn try_start_pull(&self, app_handle: tauri::AppHandle, auth: Option<AuthData>) {
        let mut guard = self.inner.lock().unwrap();
        let inner = match guard.as_mut() {
            Some(i) => i,
            None => return,
        };

        // 已在运行中
        if inner.task.is_some() {
            return;
        }

        // 不需要拉流
        if !self.should_pull() {
            return;
        }

        let room_id = inner.room_id;
        let channel = inner.stream_channel.clone();
        let abort = inner.abort.clone();
        let notify = inner.notify.clone();
        abort.store(true, Ordering::Relaxed);

        let audio_active = self.audio_active.load(Ordering::Relaxed);
        let video_active = self.video_active.load(Ordering::Relaxed);

        debug!(
            "[audio] 启动拉流任务 room={room_id}, audio={audio_active}, video={video_active}"
        );

        let handle = tauri::async_runtime::spawn(async move {
            run_stream_pull(room_id, channel, abort, notify, app_handle, auth).await;
        });

        inner.task = Some(handle);
    }

    /// 当 track 状态变更时调用
    fn on_track_change(&self, app_handle: tauri::AppHandle, auth: Option<AuthData>) {
        if self.should_pull() {
            self.try_start_pull(app_handle, auth);
        } else {
            self.notify();
        }
    }
}

// ── 命令：准备音频流（传递 Channel 并存储状态，立即返回）──

#[tauri::command]
pub async fn prepare_audio_stream(
    room_id: u64,
    stream_channel: Channel<Vec<u8>>,
    audio_state: State<'_, LiveAudioState>,
) -> Result<(), String> {
    debug!("[audio] prepare_audio_stream room={room_id}");

    // 断开旧流（如果有）
    audio_state.ensure_disconnected().await;

    let abort = Arc::new(AtomicBool::new(true));
    let notify = Arc::new(tokio::sync::Notify::new());

    *audio_state.inner.lock().unwrap() = Some(Inner {
        room_id,
        stream_channel,
        abort,
        notify,
        task: None,
    });

    Ok(())
}

// ── 命令：设置音视频 track 激活状态 ─────────────────

#[tauri::command]
pub async fn set_track_active(
    audio: bool,
    video: bool,
    audio_state: State<'_, LiveAudioState>,
    cookie_store: State<'_, CookieStore>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    debug!("[audio] set_track_active audio={audio}, video={video}");

    let prev_should_pull = audio_state.should_pull();
    audio_state.audio_active.store(audio, Ordering::Relaxed);
    audio_state.video_active.store(video, Ordering::Relaxed);
    let now_should_pull = audio_state.should_pull();

    if now_should_pull != prev_should_pull {
        // 提取 auth，在后台任务中使用（避免 State 生命周期问题）
        let auth = {
            cookie_store
                .auth
                .lock()
                .map_err(|e| e.to_string())?
                .clone()
        };
        audio_state.on_track_change(app_handle, auth);
    }

    Ok(())
}

// ── 命令：停止音频流（完全清理）─────────────────────

#[tauri::command]
pub async fn stop_audio_stream(
    audio_state: State<'_, LiveAudioState>,
) -> Result<(), String> {
    debug!("[audio] stop_audio_stream 完全清理");
    audio_state.audio_active.store(false, Ordering::Relaxed);
    audio_state.video_active.store(false, Ordering::Relaxed);
    audio_state.ensure_disconnected().await;
    Ok(())
}

// ── 后台拉流任务 ───────────────────────────────────

async fn run_stream_pull(
    room_id: u64,
    stream_channel: Channel<Vec<u8>>,
    abort: Arc<AtomicBool>,
    notify: Arc<tokio::sync::Notify>,
    app_handle: tauri::AppHandle,
    auth: Option<AuthData>,
) {
    loop {
        if !abort.load(Ordering::Relaxed) {
            break;
        }

        // 获取 FLV URL
        let flv_url =
            match web_client::fetch_flv_url(room_id, auth.as_ref(), &app_handle).await {
                Ok(url) => url,
                Err(e) => {
                    warn!("[audio] room={room_id} 获取 FLV URL 失败: {e}");
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {},
                        _ = notify.notified() => {},
                    }
                    continue;
                }
            };

        debug!("[audio] room={room_id} FLV URL 获取成功, 开始连接...");

        let response = match reqwest::Client::new()
            .get(&flv_url)
            .header("Referer", "https://live.bilibili.com/")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            )
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                warn!("[audio] room={room_id} FLV 连接失败: {e}");
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {},
                    _ = notify.notified() => {},
                }
                continue;
            }
        };

        debug!("[audio] room={room_id} FLV 连接成功, 开始接收数据...");
        let mut stream = response.bytes_stream();
        let mut chunk_count = 0u64;

        loop {
            if !abort.load(Ordering::Relaxed) {
                debug!("[audio] room={room_id} 收到中断信号, 停止拉流");
                break;
            }

            let chunk = tokio::select! {
                m = stream.next() => m,
                _ = notify.notified() => {
                    if !abort.load(Ordering::Relaxed) {
                        break;
                    }
                    continue;
                }
            };

            match chunk {
                Some(Ok(data)) => {
                    if chunk_count == 0 {
                        debug!(
                            "[audio] room={room_id} 收到第一个数据包, size={}",
                            data.len()
                        );
                    }
                    if stream_channel.send(data.to_vec()).is_err() {
                        info!(
                            "[audio] room={room_id} Channel 断开, 停止发送 (已发 {chunk_count} 包)"
                        );
                        break;
                    }
                }
                Some(Err(e)) => {
                    warn!("[audio] room={room_id} FLV 流读取错误: {e}");
                    break;
                }
                None => {
                    info!("[audio] room={room_id} 流正常结束");
                    break;
                }
            }
            chunk_count += 1;
        }

        debug!("[audio] room={room_id} 流连接关闭, 共 {chunk_count} 包");

        if abort.load(Ordering::Relaxed) {
            // 流自己断开了，等待后重试
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {},
                _ = notify.notified() => {},
            }
        } else {
            break;
        }
    }

    debug!("[audio] room={room_id} 拉流任务退出");
}
