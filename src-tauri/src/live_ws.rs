use std::io::Read;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use brotli_decompressor::Decompressor;
use futures_util::{SinkExt, StreamExt};
use log::{debug, info, trace, warn};
use tauri::ipc::Channel;
use tauri::State;
use tauri_plugin_http::reqwest;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::cookie_store::CookieStore;
use crate::utils;
use crate::wbi_sign;

// ── 数据结构 ───────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct MedalInfo {
    pub level: u32,
    pub name: String,
    pub color: String,
    pub guard_level: u32,
}

#[derive(Clone, serde::Serialize)]
pub struct DanmuUserInfo {
    pub uid: u64,
    pub face: String,
    pub name: String,
}

#[derive(Clone, serde::Serialize)]
pub struct EmoticonInfo {
    pub url: String,
    pub desc: String,
}

#[derive(Clone, serde::Serialize)]
pub struct DanmuEvent {
    pub ts: u64,
    pub text: String,
    pub nickname: String,
    pub timeline: String,
    pub medal: Option<MedalInfo>,
    pub user: DanmuUserInfo,
    pub emoticon: Option<EmoticonInfo>,
    #[serde(rename = "type")]
    pub dm_type: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ScUserInfo {
    pub uid: u64,
    pub face: String,
    pub uname: String,
}

#[derive(Clone, serde::Serialize)]
pub struct SuperChatEvent {
    pub id: u64,
    pub message: String,
    pub price: u32,
    pub time: u32,
    pub ts: u64,
    pub medal: Option<MedalInfo>,
    pub user_info: ScUserInfo,
}

#[derive(Clone, serde::Serialize)]
pub struct RoomStatusEvent {
    pub online: u32,
}

#[derive(Clone, serde::Serialize)]
pub struct WsErrorEvent {
    pub message: String,
}

// ── 获取弹幕服务器 ──────────────────────────────────

#[derive(serde::Deserialize)]
struct DanmuHost {
    host: String,
    port: u16,
    #[serde(default)]
    wss_port: u16,
}

#[derive(serde::Deserialize)]
struct DanmuInfoData {
    token: String,
    host_list: Vec<DanmuHost>,
}

#[derive(serde::Deserialize)]
struct DanmuInfoRes {
    code: i32,
    data: Option<DanmuInfoData>,
}

async fn get_danmu_info(
    room_id: u64,
    auth: &Option<crate::cookie_store::AuthData>,
    app_handle: &tauri::AppHandle,
) -> Result<(String, String), String> {
    let mut params = std::collections::HashMap::new();
    params.insert("id".to_string(), room_id.to_string());
    let mixin_key = wbi_sign::get_mixin_key(app_handle).await?;
    let (w_rid, wts) = wbi_sign::sign_params(&params, &mixin_key);
    let url = format!(
        "https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id={}&w_rid={}&wts={}",
        room_id, w_rid, wts
    );

    let mut req = reqwest::Client::new().get(&url);
    if let Some(ref a) = auth {
        req = req.header("Cookie", utils::build_cookie_header(&a.cookies));
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("getDanmuInfo 请求失败: {}", e))?
        .json::<DanmuInfoRes>()
        .await
        .map_err(|e| format!("getDanmuInfo 解析失败: {}", e))?;
    match res.data {
        Some(data) if !data.host_list.is_empty() => {
            let host = &data.host_list[0];
            let url = if host.wss_port > 0 {
                format!("wss://{}:{}/sub", host.host, host.wss_port)
            } else {
                format!("wss://{}:{}/sub", host.host, host.port)
            };
            Ok((url, data.token))
        }
        _ => Err(format!("getDanmuInfo 无可用服务器, code={}", res.code)),
    }
}

// ── 包头 / 解压 / 解析 ─────────────────────────────

#[derive(Debug)]
struct PacketHeader {
    total_len: u32,
    header_len: u16,
    proto_ver: u16,
    op_code: u32,
    _seq: u32,
}

fn parse_header(data: &[u8]) -> Option<PacketHeader> {
    if data.len() < 16 {
        return None;
    }
    Some(PacketHeader {
        total_len: u32::from_be_bytes([data[0], data[1], data[2], data[3]]),
        header_len: u16::from_be_bytes([data[4], data[5]]),
        proto_ver: u16::from_be_bytes([data[6], data[7]]),
        op_code: u32::from_be_bytes([data[8], data[9], data[10], data[11]]),
        _seq: u32::from_be_bytes([data[12], data[13], data[14], data[15]]),
    })
}

fn brotli_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut d = Decompressor::new(data, 4096);
    let mut out = Vec::new();
    d.read_to_end(&mut out)
        .map_err(|e| format!("brotli 解压失败: {}", e))?;
    Ok(out)
}

fn parse_messages(body: &[u8], proto_ver: u16) -> Result<Vec<String>, String> {
    let raw = match proto_ver {
        0 | 1 => body.to_vec(),
        2 => return Err("zlib 已不再支持".into()),
        3 => brotli_decompress(body)?,
        _ => return Err(format!("未知协议版本: {}", proto_ver)),
    };
    let mut messages = Vec::new();
    let mut offset = 0usize;
    while offset + 16 <= raw.len() {
        let h = parse_header(&raw[offset..]).ok_or("解析子包头失败")?;
        let bs = offset + h.header_len as usize;
        let be = offset + h.total_len as usize;
        if be > raw.len() {
            break;
        }
        let sub = &raw[bs..be];
        if h.proto_ver == 3 {
            let inner = brotli_decompress(sub)?;
            let mut io = 0usize;
            while io + 16 <= inner.len() {
                let ih = parse_header(&inner[io..]).unwrap();
                let is = io + ih.header_len as usize;
                let ie = io + ih.total_len as usize;
                if ie > inner.len() {
                    break;
                }
                let s = String::from_utf8_lossy(&inner[is..ie]).to_string();
                if !s.is_empty() {
                    messages.push(s)
                }
                if ih.total_len == 0 {
                    break;
                }
                io += ih.total_len as usize;
            }
        } else {
            let s = String::from_utf8_lossy(sub).to_string();
            if !s.is_empty() {
                messages.push(s)
            }
        }
        if h.total_len == 0 {
            break;
        }
        offset += h.total_len as usize;
    }
    Ok(messages)
}

// ── JSON 解析 ──────────────────────────────────────

fn parse_danmu(json: &serde_json::Value) -> Option<DanmuEvent> {
    let info = json.get("info")?.as_array()?;
    let ts = info.first()?.as_array()?.get(4)?.as_u64().unwrap_or(0);
    let text = info
        .get(1)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let timeline = info
        .get(9)
        .and_then(|v| v.as_i64())
        .map(|t| t.to_string())
        .unwrap_or_default();
    let sender = info.get(2)?.as_array()?;
    let uid = sender.first().and_then(|v| v.as_u64()).unwrap_or(0);
    let nickname = sender
        .get(1)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let user_base = info
        .first()?
        .as_array()?
        .get(15)
        .and_then(|v| v.get("user"))
        .and_then(|v| v.get("base"));
    let nickname = user_base
        .and_then(|b| b.get("name"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&nickname)
        .to_string();
    let face = user_base
        .and_then(|b| b.get("face"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string();
    let medal = info.get(3).and_then(|v| v.as_array()).and_then(|m| {
        Some(MedalInfo {
            level: m.first()?.as_u64()? as u32,
            name: m.get(1)?.as_str()?.to_string(),
            color: format!("#{:06x}", m.get(4)?.as_u64()? & 0xFFFFFF),
            guard_level: m.get(10)?.as_u64()? as u32,
        })
    });
    let emoticon = info.get(13).and_then(|v| v.as_object()).and_then(|e| {
        Some(EmoticonInfo {
            url: e.get("url")?.as_str()?.to_string(),
            desc: e.get("emoticon_unique")?.as_str()?.to_string(),
        })
    });
    let dm_type = if emoticon.is_some() { "emote" } else { "text" };
    Some(DanmuEvent {
        ts,
        text,
        nickname: nickname.clone(),
        timeline,
        medal,
        user: DanmuUserInfo {
            uid,
            face,
            name: nickname,
        },
        emoticon,
        dm_type: dm_type.to_string(),
    })
}

fn parse_sc(json: &serde_json::Value) -> Option<SuperChatEvent> {
    let data = json.get("data")?;
    let ts = data.get("start_time").and_then(|v| v.as_u64()).unwrap_or(0);
    let medal = data.get("medal_info").and_then(|m| {
        Some(MedalInfo {
            level: m.get("medal_level")?.as_u64()? as u32,
            name: m.get("medal_name")?.as_str()?.to_string(),
            color: m
                .get("medal_color")
                .and_then(|c| c.as_str())
                .unwrap_or("#000000")
                .to_string(),
            guard_level: m.get("guard_level")?.as_u64()? as u32,
        })
    });
    Some(SuperChatEvent {
        id: data.get("id")?.as_u64()?,
        message: data.get("message")?.as_str()?.to_string(),
        price: data.get("price")?.as_u64()? as u32,
        time: data.get("time")?.as_u64()? as u32,
        ts,
        medal,
        user_info: ScUserInfo {
            uid: data.get("uid")?.as_u64()?,
            face: data
                .get("user_info")?
                .get("face")?
                .as_str()
                .unwrap_or("")
                .to_string(),
            uname: data
                .get("user_info")?
                .get("uname")?
                .as_str()
                .unwrap_or("")
                .to_string(),
        },
    })
}

fn build_packet(op_code: u32, body: &[u8]) -> Vec<u8> {
    let total = 16 + body.len() as u32;
    let mut buf = Vec::with_capacity(total as usize);
    buf.extend_from_slice(&total.to_be_bytes());
    buf.extend_from_slice(&16u16.to_be_bytes());
    buf.extend_from_slice(&1u16.to_be_bytes());
    buf.extend_from_slice(&op_code.to_be_bytes());
    buf.extend_from_slice(&1u32.to_be_bytes());
    buf.extend_from_slice(body);
    buf
}

fn dispatch(
    json: &serde_json::Value,
    danmu: &Channel<DanmuEvent>,
    sc: &Channel<SuperChatEvent>,
    status: &Channel<RoomStatusEvent>,
) {
    let cmd = json.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
    match cmd {
        "DANMU_MSG" => {
            if let Some(d) = parse_danmu(json) {
                let _ = danmu.send(d);
            }
        }
        "SUPER_CHAT_MESSAGE" => {
            if let Some(s) = parse_sc(json) {
                let _ = sc.send(s);
            }
        }
        "ONLINE_RANK_COUNT" => {
            if let Some(n) = json
                .get("data")
                .and_then(|d| d.get("online_count"))
                .and_then(|v| v.as_u64())
            {
                let _ = status.send(RoomStatusEvent { online: n as u32 });
            }
        }
        _ => {}
    }
}

// ── 连接管理器 ─────────────────────────────────────

struct Inner {
    abort: Arc<AtomicBool>,
    notify: Arc<tokio::sync::Notify>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub struct LiveWsState {
    inner: Mutex<Option<Inner>>,
}

impl Default for LiveWsState {
    fn default() -> Self {
        LiveWsState {
            inner: Mutex::new(None),
        }
    }
}

impl LiveWsState {
    /// 检查并断开旧连接，返回 true 表示成功断开
    async fn ensure_disconnected(&self) {
        let old = { self.inner.lock().unwrap().take() };
        if let Some(inner) = old {
            inner.abort.store(false, Ordering::Relaxed);
            inner.notify.notify_one();
            if let Some(task) = inner.task {
                let _ = task.await;
            }
        }
    }

    fn set_connected(
        &self,
        abort: Arc<AtomicBool>,
        notify: Arc<tokio::sync::Notify>,
        task: tauri::async_runtime::JoinHandle<()>,
    ) {
        *self.inner.lock().unwrap() = Some(Inner {
            abort,
            notify,
            task: Some(task),
        });
    }
}

// ── 后台连接任务 ───────────────────────────────────

struct Channels {
    danmu: Channel<DanmuEvent>,
    sc: Channel<SuperChatEvent>,
    status: Channel<RoomStatusEvent>,
    error: Channel<WsErrorEvent>,
    room_id: u64,
}

async fn run_connection(
    ch: Channels,
    auth: Option<crate::cookie_store::AuthData>,
    app_handle: tauri::AppHandle,
    abort: Arc<AtomicBool>,
    notify: Arc<tokio::sync::Notify>,
) {
    let result = run_ws_loop(
        ch.room_id,
        ch.danmu,
        ch.sc,
        ch.status,
        ch.error,
        &auth,
        &app_handle,
        abort,
        notify,
    )
    .await;
    if let Err(e) = result {
        info!("[wss] 连接错误: {}", e);
    }
}

// ── connect 命令 ───────────────────────────────────

#[tauri::command]
pub async fn connect_live_room(
    room_id: u64,
    danmu_channel: Channel<DanmuEvent>,
    sc_channel: Channel<SuperChatEvent>,
    status_channel: Channel<RoomStatusEvent>,
    error_channel: Channel<WsErrorEvent>,
    cookie_store: State<'_, CookieStore>,
    live_ws_state: State<'_, LiveWsState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    debug!("[wss] connect_live_room 被调用, room_id={}", room_id);
    // 1. 断开旧连接
    live_ws_state.ensure_disconnected().await;

    // 2. 准备数据
    let auth = { cookie_store.auth.lock().map_err(|e| e.to_string())?.clone() };
    let abort = Arc::new(AtomicBool::new(true));
    let notify = Arc::new(tokio::sync::Notify::new());

    let ch = Channels {
        danmu: danmu_channel,
        sc: sc_channel,
        status: status_channel,
        error: error_channel,
        room_id,
    };

    // 3. 后台启动
    let abort2 = abort.clone();
    let notify2 = notify.clone();
    let handle = tauri::async_runtime::spawn(async move {
        run_connection(ch, auth, app_handle, abort2, notify2).await;
    });

    // 4. 记录状态
    live_ws_state.set_connected(abort, notify, handle);
    Ok(())
}

// ── disconnect 命令 ────────────────────────────────

#[tauri::command]
pub async fn disconnect_live_room(live_ws_state: State<'_, LiveWsState>) -> Result<(), String> {
    debug!("前端请求断开 WSS 连接");
    live_ws_state.ensure_disconnected().await;
    Ok(())
}

// ── 实际 WSS 循环 ──────────────────────────────────

async fn run_ws_loop(
    room_id: u64,
    danmu_tx: Channel<DanmuEvent>,
    sc_tx: Channel<SuperChatEvent>,
    status_tx: Channel<RoomStatusEvent>,
    error_tx: Channel<WsErrorEvent>,
    auth: &Option<crate::cookie_store::AuthData>,
    app_handle: &tauri::AppHandle,
    abort: Arc<AtomicBool>,
    notify: Arc<tokio::sync::Notify>,
) -> Result<(), String> {
    // 辅助：发送错误到前端并返回 Err
    macro_rules! fail {
        ($msg:expr $(, $arg:expr)*) => {{
            let msg = format!($msg $(, $arg)*);
            let _ = error_tx.send(WsErrorEvent { message: msg.clone() });
            msg
        }};
    }

    let (wss_url, token) = get_danmu_info(room_id, auth, app_handle)
        .await
        .map_err(|e| fail!("{e}"))?;

    debug!("[wss] room={room_id} 弹幕服务器: {wss_url}");

    let uid = auth
        .as_ref()
        .and_then(|a| a.cookies.get("DedeUserID"))
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    let cookie_str = auth
        .as_ref()
        .map(|a| utils::build_cookie_header(&a.cookies));

    // 重试连接（最多 3 次），只在全部失败时才通知前端
    const MAX_RETRIES: usize = 3;
    let mut ws_stream = None;
    let mut last_err = String::new();
    for attempt in 0..MAX_RETRIES {
        let mut request = wss_url
            .as_str()
            .into_client_request()
            .map_err(|e| format!("构建请求失败: {e}"))?;
        {
            let headers = request.headers_mut();
            headers.insert("Origin", "https://live.bilibili.com".parse().unwrap());
            headers.insert(
                "User-Agent",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                    .parse()
                    .unwrap(),
            );
            headers.insert("Referer", "https://live.bilibili.com/".parse().unwrap());
            if let Some(ref c) = cookie_str {
                headers.insert(
                    "Cookie",
                    c.parse().map_err(|e| fail!("Cookie 解析失败: {e}"))?,
                );
            }
        }

        let result =
            tokio::time::timeout(std::time::Duration::from_secs(10), connect_async(request)).await;

        match result {
            Ok(Ok((stream, _))) => {
                ws_stream = Some(stream);
                break;
            }
            Ok(Err(e)) => {
                last_err = format!("WSS 连接失败: {e}");
                warn!("[wss] room={room_id} 第{}次连接失败: {e}", attempt + 1);
            }
            Err(_) => {
                last_err = "WSS 连接超时".into();
                warn!("[wss] room={room_id} 第{}次连接超时", attempt + 1);
            }
        }

        if attempt < MAX_RETRIES - 1 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    let ws_stream = ws_stream.ok_or_else(|| fail!("{last_err}"))?;

    // Arc<Mutex<>> 串行化读写，避免 rustls TLS 会话并发损坏
    let ws = Arc::new(tokio::sync::Mutex::new(ws_stream));

    // 认证
    let auth_body = serde_json::to_vec(&serde_json::json!({ "uid": uid, "roomid": room_id, "protover": 3, "platform": "web", "type": 2, "key": token })).unwrap();
    ws.lock()
        .await
        .send(Message::Binary(build_packet(7, &auth_body).into()))
        .await
        .map_err(|e| fail!("认证发送失败: {e}"))?;

    // 通知前端连接成功
    let _ = error_tx.send(WsErrorEvent {
        message: "success".into(),
    });

    // 心跳
    let heartbeat = build_packet(2, b"[object Object]");
    let ws_hb = ws.clone();
    let abort_hb = abort.clone();
    tauri::async_runtime::spawn(async move {
        while abort_hb.load(Ordering::Relaxed) {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            if !abort_hb.load(Ordering::Relaxed) {
                break;
            }
            trace!("[wss] heartbeat");
            if ws_hb
                .lock()
                .await
                .send(Message::Binary(heartbeat.clone().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // 接收循环
    loop {
        let msg = {
            let mut stream = ws.lock().await;
            tokio::select! {
                m = stream.next() => m,
                _ = notify.notified() => None,
            }
        };

        if !abort.load(Ordering::Relaxed) {
            break;
        }

        match msg {
            Some(Ok(Message::Binary(data))) => {
                if data.len() < 16 {
                    continue;
                }
                let header = match parse_header(&data) {
                    Some(h) => h,
                    None => continue,
                };
                match header.op_code {
                    5 => {
                        if let Ok(msgs) = parse_messages(&data[16..], header.proto_ver) {
                            for s in msgs {
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&s) {
                                    dispatch(&json, &danmu_tx, &sc_tx, &status_tx);
                                }
                            }
                        }
                    }
                    8 => {
                        let body_str = String::from_utf8_lossy(&data[16..]);
                        debug!("[wss] room={room_id} 收到认证响应: {}", body_str);
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body_str) {
                            if json.get("code").and_then(|c| c.as_i64()).unwrap_or(-1) == 0 {
                                info!("[wss] room={room_id} 认证成功");
                            } else {
                                let _ = error_tx.send(WsErrorEvent {
                                    message: format!("认证失败: {}", body_str),
                                });
                                break;
                            }
                        }
                    }
                    3 => {}
                    _ => {}
                }
            }
            Some(Ok(_)) => continue,
            Some(Err(e)) => {
                warn!("[wss] room={room_id} 连接错误: {}", e);
                let _ = error_tx.send(WsErrorEvent {
                    message: format!("WSS 错误: {}", e),
                });
                break;
            }
            None => {
                let _ = error_tx.send(WsErrorEvent {
                    message: "服务器关闭了连接".into(),
                });
                info!("[wss] room={room_id} 流正常关闭");
                break;
            }
        }
    }

    abort.store(false, Ordering::Relaxed);
    info!("[wss] room={room_id} 消息流断开");
    Ok(())
}
