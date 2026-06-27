use std::collections::HashMap;

use log::{debug, info, warn};

use crate::cookie_store::{AuthData, CookieStore};
use crate::live_ws;
use crate::models::*;
use crate::utils;
use crate::wbi_sign;
use tauri::State;
use tauri_plugin_http::reqwest;

// ── 生成二维码 ────────────────────────────────────────

#[tauri::command]
pub async fn get_login_qrcode() -> Result<LoginQrcodeRes, String> {
    let res = reqwest::get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
        .await
        .map_err(|e| e.to_string())?
        .json::<LoginQrcodeRes>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(res)
}

// ── 轮询登录状态 ──────────────────────────────────────

#[tauri::command]
pub async fn check_qrcode_status(
    qrcode_key: String,
    cookie_store: State<'_, CookieStore>,
) -> Result<QrcodeStatusRes, String> {
    let url = format!(
        "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key={}",
        qrcode_key
    );

    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;

    let raw_cookies: Vec<String> = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .collect();

    let poll = response
        .json::<BiliPollRes>()
        .await
        .map_err(|e| e.to_string())?;

    let inner_code = poll.data.as_ref().map(|d| d.code);

    let (status, message) = match inner_code {
        Some(86101) => ("pending".into(), "等待扫描".into()),
        Some(86090) => ("scanned".into(), "已扫描，请在手机上确认".into()),
        Some(0) => ("success".into(), "登录成功".into()),
        Some(86038) => ("expired".into(), "二维码已过期".into()),
        _ => (
            "unknown".into(),
            poll.message.unwrap_or_else(|| "未知状态".into()),
        ),
    };

    // 登录成功：解析 cookies + refresh_token，持久化
    if status == "success" && !raw_cookies.is_empty() {
        let cookies = utils::parse_set_cookies(&raw_cookies);
        let refresh_token = poll
            .data
            .as_ref()
            .and_then(|d| d.refresh_token.clone())
            .unwrap_or_default();

        if !refresh_token.is_empty() {
            cookie_store.set(AuthData {
                cookies,
                refresh_token,
            })?;
        }
    }

    Ok(QrcodeStatusRes { status, message })
}

// ── 快速查询登录状态（不触发刷新）───────────────────────

/// 仅判断是否已登录，不触发网络请求
#[tauri::command]
pub fn get_login_status(cookie_store: State<'_, CookieStore>) -> Result<LoginStatusRes, String> {
    let logged_in = cookie_store
        .auth
        .lock()
        .map_err(|e| e.to_string())?
        .is_some();
    Ok(LoginStatusRes {
        logged_in,
        needs_refresh: false,
        message: if logged_in {
            "已登录".into()
        } else {
            "未登录".into()
        },
    })
}

// ── 检查并刷新 cookie ─────────────────────────────────

/// 前端 / 启动时调用：仅检测是否已登录，不触发刷新
#[tauri::command]
pub async fn check_cookie(cookie_store: State<'_, CookieStore>) -> Result<LoginStatusRes, String> {
    let logged_in = {
        let guard = cookie_store.auth.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };
    Ok(LoginStatusRes {
        logged_in,
        needs_refresh: false,
        message: if logged_in {
            "已登录".into()
        } else {
            "未登录".into()
        },
    })
}

// ── 导航栏用户信息 ────────────────────────────────────

/// 获取导航栏用户信息（需要已登录 cookie）
#[tauri::command]
pub async fn get_nav_user_info(
    cookie_store: State<'_, CookieStore>,
) -> Result<NavUserInfo, String> {
    let auth = {
        let guard = cookie_store.auth.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    // 构造请求
    let mut req = reqwest::Client::new().get("https://api.bilibili.com/x/web-interface/nav");

    if let Some(ref a) = auth {
        let cookie_str = utils::build_cookie_header(&a.cookies);
        req = req.header("Cookie", cookie_str);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("请求 nav 接口失败: {}", e))?
        .json::<NavResRaw>()
        .await
        .map_err(|e| format!("解析 nav 响应失败: {}", e))?;

    match res.data {
        Some(data) => {
            let level_info = data.level_info.map_or(
                NavLevelInfo {
                    current_level: 0,
                    current_exp: 0,
                    next_exp: "0".into(),
                },
                |l| {
                    let next_exp = match l.next_exp {
                        serde_json::Value::Number(n) => n.to_string(),
                        serde_json::Value::String(s) => s,
                        _ => "0".into(),
                    };
                    NavLevelInfo {
                        current_level: l.current_level,
                        current_exp: l.current_exp,
                        next_exp,
                    }
                },
            );

            Ok(NavUserInfo {
                is_login: data.is_login,
                face: data.face,
                mid: data.mid,
                uname: data.uname,
                level_info,
            })
        }
        None if res.code == -101 => {
            handle_error_code(res.code, &cookie_store);
            Ok(NavUserInfo {
                is_login: false,
                face: String::new(),
                mid: 0,
                uname: String::new(),
                level_info: NavLevelInfo {
                    current_level: 0,
                    current_exp: 0,
                    next_exp: "0".into(),
                },
            })
        }
        None => {
            handle_error_code(res.code, &cookie_store);
            Err(format!("nav 接口返回空数据, code={}", res.code))
        }
    }
}

// ── 关注 UP 正在直播列表 ────────────────────────────

/// 根据 uid 列表批量获取封面、关键帧、在线人数
async fn fetch_room_covers(uids: &[u64]) -> std::collections::HashMap<u64, (String, String, u32)> {
    if uids.is_empty() {
        return std::collections::HashMap::new();
    }

    // 用 GET 方式，uids[] 参数拼接
    let mut url =
        String::from("https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids");
    for (i, uid) in uids.iter().enumerate() {
        if i == 0 {
            url.push('?');
        } else {
            url.push('&');
        }
        url.push_str(&format!("uids[]={}", uid));
    }

    let res = match reqwest::get(&url).await {
        Ok(r) => r,
        Err(_) => return std::collections::HashMap::new(),
    };

    let parsed = match res.json::<BatchStatusResRaw>().await {
        Ok(p) => p,
        Err(_) => return std::collections::HashMap::new(),
    };

    let mut map = std::collections::HashMap::new();
    if let Some(data) = parsed.data {
        for (uid_str, room) in data {
            if let Ok(uid) = uid_str.parse::<u64>() {
                map.insert(uid, (room.cover_from_user, room.keyframe, room.online));
            }
        }
    }
    map
}

/// 获取关注 UP 中正在直播的列表（PC 端 GetWebList，hit_ab=true）
/// 随后调用批量查询接口补齐封面 URL
#[tauri::command]
pub async fn get_following_lives(
    cookie_store: State<'_, CookieStore>,
) -> Result<FollowingLivesRes, String> {
    let auth = {
        let guard = cookie_store.auth.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut req = reqwest::Client::new()
        .get("https://api.live.bilibili.com/xlive/web-ucenter/v1/xfetter/GetWebList")
        .query(&[("hit_ab", "true")]);

    if let Some(ref a) = auth {
        let cookie_str = utils::build_cookie_header(&a.cookies);
        req = req.header("Cookie", cookie_str);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("请求 GetWebList 失败: {}", e))?
        .json::<WebListResRaw>()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    debug!("[api] GetWebList code={}", res.code);

    match res.data {
        Some(data) => {
            // 提取所有 uid 用于批量查询封面
            let uids: Vec<u64> = data.list.iter().map(|it| it.uid).collect();
            let cover_map = fetch_room_covers(&uids).await;

            let list: Vec<FollowingLiveItem> = data
                .list
                .into_iter()
                .map(|it| {
                    let (cover_url, keyframe, online) =
                        cover_map.get(&it.uid).cloned().unwrap_or_default();
                    FollowingLiveItem {
                        room_id: it.room_id,
                        uid: it.uid,
                        uname: it.uname,
                        face: it.face,
                        title: it.title,
                        online,
                        live_status: it.live_status,
                        live_time: it.live_time,
                        area_name: it.area_name,
                        area_v2_name: it.area_v2_name,
                        area_v2_parent_name: it.area_v2_parent_name,
                        tag_name: it.tag_name,
                        cover_url,
                        keyframe,
                    }
                })
                .collect();

            Ok(FollowingLivesRes {
                live_count: list.len() as u32,
                list,
            })
        }
        None => {
            handle_error_code(res.code, &cookie_store);
            if res.code == -101 {
                Err("未登录，无法获取关注列表".into())
            } else {
                Err(format!("接口返回空数据, code={}", res.code))
            }
        }
    }
}

// ── 图片代理（绕过 B 站 Referer 防盗链 + LRU 缓存）─────

use crate::image_cache::ImageCache;

/// 下载指定 URL 的图片，返回 base64 data URL。
/// 自动附带 `Referer: https://www.bilibili.com/` 以绕过防盗链检查。
/// `use_disk`: true=内存+磁盘缓存，false=仅内存缓存。
#[tauri::command]
pub async fn fetch_image_base64(
    url: String,
    use_disk: bool,
    image_cache: tauri::State<'_, ImageCache>,
) -> Result<String, String> {
    // 命中缓存直接返回
    let cached = if use_disk {
        image_cache.get(&url).await
    } else {
        image_cache.get_mem(&url)
    };
    if let Some(cached) = cached {
        return Ok(cached);
    }

    let response = reqwest::Client::new()
        .get(&url)
        .header("Referer", "https://www.bilibili.com/")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("请求图片失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("图片请求失败, HTTP {}", status.as_u16()));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取图片失败: {}", e))?;

    // 写入缓存
    let data_url = if use_disk {
        image_cache.put(url, content_type, &bytes).await
    } else {
        image_cache.put_mem(url, content_type, &bytes)
    };

    Ok(data_url)
}

// ── 风控检测 ──────────────────────────────────────────

/// 检测 B 站 API 响应的 code 字段，做好对应处理：
/// - `-101`：cookie 已失效 → 清除 cookie
/// - `-412`：请求过频（cookie 仍有效，仅限流）
/// - `-352`：账号异常需验证（cookie 可能仍有效）
/// - `19002003`：房间不存在或未开播（轮播/录播无推流地址）
pub fn handle_error_code(code: i32, cookie_store: &CookieStore) {
    match code {
        -101 => {
            warn!("[auth] cookie 已失效 (code=-101)，清除缓存");
            let _ = cookie_store.clear();
        }
        -412 => {
            warn!("[risk-control] 请求过于频繁 (code=-412)，请降低请求速率");
        }
        -352 => {
            warn!("[risk-control] 账号触发风控验证 (code=-352)，可能需要手动验证");
        }
        19002003 => {
            info!("[live] 房间不存在或未开播 (code=19002003)");
        }
        _ => {}
    }
}

/// 前端调用：手动清除 cookie（内存 + 磁盘文件）
#[tauri::command]
pub fn clear_cookies(cookie_store: State<'_, CookieStore>) -> Result<(), String> {
    cookie_store.clear()
}

// ── 获取直播间视频流地址 ──────────────────────────────

// ── 内部辅助：请求 playUrl 接口，返回原始数据 ──────────

async fn fetch_play_url_raw(
    room_id: u64,
    auth: Option<&AuthData>,
    _app_handle: &tauri::AppHandle,
) -> Result<PlayUrlResRaw, String> {
    let url = format!(
        "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?\
         room_id={}&protocol=0&format=0&codec=0&qn=80&platform=web&ptype=8&dolby=5&panoramic=1",
        room_id
    );

    let mut req = reqwest::Client::new().get(&url);
    if let Some(ref a) = auth {
        let cookie_str = utils::build_cookie_header(&a.cookies);
        req = req.header("Cookie", cookie_str);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("请求播放地址失败: {}", e))?
        .json::<PlayUrlResRaw>()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    Ok(res)
}

/// 获取直播间视频流地址
/// - `qn=80` 最低画质（流畅）
/// - 携带 WBI 签名
/// - 如果已登录则携带 Cookie
#[tauri::command]
pub async fn get_live_play_url(
    room_id: u64,
    cookie_store: State<'_, CookieStore>,
    app_handle: tauri::AppHandle,
) -> Result<LivePlayUrlRes, String> {
    let auth = {
        cookie_store
            .auth
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
    };
    let res = fetch_play_url_raw(room_id, auth.as_ref(), &app_handle).await?;
    debug!("[api] playUrl room={room_id} code={}", res.code);

    match (res.code, res.data) {
        (0, Some(data)) => {
            let playurl = &data.playurl_info.playurl;

            // 优先选择 http_stream + flv + avc 流
            let selected_codec = playurl
                .stream
                .iter()
                .find(|s| s.protocol_name == "http_stream")
                .and_then(|s| s.format.iter().find(|f| f.format_name == "flv"))
                .and_then(|f| f.codec.iter().find(|c| c.codec_name == "avc"));

            let stream_url = selected_codec
                .and_then(|c| {
                    c.url_info
                        .first()
                        .map(|info| format!("{}{}{}", info.host, c.base_url, info.extra))
                })
                .unwrap_or_default();

            let current_qn = selected_codec.map(|c| c.current_qn).unwrap_or(0);

            let quality_desc = playurl
                .g_qn_desc
                .iter()
                .find(|q| q.qn == current_qn)
                .map(|q| q.desc.clone())
                .unwrap_or_else(|| "未知".to_string());

            Ok(LivePlayUrlRes {
                code: 0,
                message: None,
                data: Some(LivePlayUrlData {
                    url: stream_url,
                    current_qn,
                    quality_desc,
                }),
            })
        }
        (code, _) => {
            handle_error_code(code, &cookie_store);
            Ok(LivePlayUrlRes {
                code,
                message: Some("获取播放地址失败".into()),
                data: None,
            })
        }
    }
}

// ── 内部辅助：获取流地址（只需 URL） ──────────────────

pub(crate) async fn fetch_flv_url(
    room_id: u64,
    auth: Option<&AuthData>,
    app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    let res = fetch_play_url_raw(room_id, auth, app_handle).await?;

    match (res.code, res.data) {
        (0, Some(data)) => {
            let playurl = &data.playurl_info.playurl;

            // 优先选择 http_stream + flv + avc 流
            let selected_codec = playurl
                .stream
                .iter()
                .find(|s| s.protocol_name == "http_stream")
                .and_then(|s| s.format.iter().find(|f| f.format_name == "flv"))
                .and_then(|f| f.codec.iter().find(|c| c.codec_name == "avc"));

            if let Some(ref c) = selected_codec {
                let qn_desc = playurl
                    .g_qn_desc
                    .iter()
                    .find(|q| q.qn == c.current_qn)
                    .map(|q| q.desc.as_str())
                    .unwrap_or("未知");
                debug!(
                    "[audio] room={room_id} 流参数: qn={}, 画质={}, 可选画质={:?}",
                    c.current_qn, qn_desc, c.accept_qn
                );
            }

            selected_codec
                .and_then(|c| {
                    c.url_info
                        .first()
                        .map(|info| format!("{}{}{}", info.host, c.base_url, info.extra))
                })
                .ok_or("无可用流地址".to_string())
        }
        (19002003, _) => {
            info!("[live] 房间不存在或未开播 (code=19002003)");
            Err("19002003".to_string()) // 前端识别此 code
        }
        (code, _) => {
            Err(format!("获取流地址失败, code={}", code))
        }
    }
}

// ── 获取直播间信息 ────────────────────────────────────

/// 获取单个直播间信息
/// 接口: `room/v1/Room/get_info`
#[tauri::command]
pub async fn get_room_info(
    room_id: u64,
    cookie_store: State<'_, CookieStore>,
) -> Result<RoomInfoRes, String> {
    let url = format!(
        "https://api.live.bilibili.com/room/v1/Room/get_info?room_id={}",
        room_id
    );

    let auth = {
        let guard = cookie_store.auth.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut req = reqwest::Client::new().get(&url);
    if let Some(ref a) = auth {
        let cookie_str = utils::build_cookie_header(&a.cookies);
        req = req.header("Cookie", cookie_str);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("请求房间信息失败: {}", e))?
        .json::<RoomInfoResRaw>()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    debug!("[api] get_info room={room_id} code={}", res.code);

    match res.data {
        Some(data) => {
            // 获取主播信息
            let user_info = fetch_user_info(data.uid, &cookie_store).await;

            Ok(RoomInfoRes {
                code: res.code,
                message: res.message,
                data: Some(RoomInfo {
                    uid: data.uid,
                    room_id: data.room_id,
                    online: data.online,
                    live_status: data.live_status,
                    area_name: data.area_name,
                    parent_area_name: data.parent_area_name,
                    title: data.title,
                    keyframe: data.keyframe,
                    live_time: data.live_time,
                    user_info,
                }),
            })
        }
        None => {
            handle_error_code(res.code, &cookie_store);
            Ok(RoomInfoRes {
                code: res.code,
                message: res.message,
                data: None,
            })
        }
    }
}

async fn fetch_user_info(uid: u64, cookie_store: &CookieStore) -> Option<UserInfo> {
    let url = format!(
        "https://api.live.bilibili.com/live_user/v1/Master/info?uid={}",
        uid,
    );

    let auth = cookie_store.auth.lock().ok()?.clone();
    let mut req = reqwest::Client::new().get(&url);
    if let Some(ref a) = auth {
        req = req.header("Cookie", utils::build_cookie_header(&a.cookies));
    }

    let res = req
        .send()
        .await
        .ok()?
        .json::<MasterInfoResRaw>()
        .await
        .ok()?;

    res.data?.info.map(|i| UserInfo {
        uid: i.uid,
        uname: i.uname,
        face: i.face,
    })
}

// ── 获取直播间历史弹幕 ─────────────────────────────

fn parse_history_item(raw: &HistoryDanmuRaw) -> HistoryDanmuItem {
    let face = raw
        .user
        .as_ref()
        .and_then(|u| u.get("base"))
        .and_then(|b| b.get("face"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string();

    let nickname = raw
        .user
        .as_ref()
        .and_then(|u| u.get("base"))
        .and_then(|b| b.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or(&raw.nickname)
        .to_string();

    let emoticon = raw.emoticon.as_ref().and_then(|e| {
        let url = e.get("url")?.as_str().filter(|s| !s.is_empty())?;
        let desc = e
            .get("emoticon_unique")?
            .as_str()
            .filter(|s| !s.is_empty())?;
        Some(live_ws::EmoticonInfo {
            url: url.to_string(),
            desc: desc.to_string(),
        })
    });

    let medal = raw
        .medal
        .as_ref()
        .and_then(|m| m.as_array())
        .and_then(|arr| {
            Some(live_ws::MedalInfo {
                level: arr.first()?.as_u64()? as u32,
                name: arr.get(1)?.as_str()?.to_string(),
                color: format!("#{:06x}", arr.get(4)?.as_u64()? & 0xFFFFFF),
                guard_level: arr.get(10)?.as_u64()? as u32,
            })
        });

    let dm_type = if emoticon.is_some() { "emote" } else { "text" };

    HistoryDanmuItem {
        text: raw.text.clone(),
        nickname,
        timeline: raw.timeline.clone(),
        uid: raw.uid,
        face,
        medal,
        emoticon,
        dm_type: dm_type.to_string(),
    }
}

#[tauri::command]
pub async fn get_history_danmu(
    room_id: u64,
    cookie_store: State<'_, CookieStore>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<HistoryDanmuItem>, String> {
    let mut params = HashMap::new();
    params.insert("roomid".to_string(), room_id.to_string());

    let mixin_key = wbi_sign::get_mixin_key(&app_handle).await?;
    let (w_rid, wts) = wbi_sign::sign_params(&params, &mixin_key);

    let url = format!(
        "https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid={}&w_rid={}&wts={}",
        room_id, w_rid, wts
    );

    let auth = {
        let guard = cookie_store.auth.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut req = reqwest::Client::new().get(&url);
    if let Some(ref a) = auth {
        let cookie_str = utils::build_cookie_header(&a.cookies);
        req = req.header("Cookie", cookie_str);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("请求历史弹幕失败: {}", e))?;

    let res = response
        .json::<HistoryResRaw>()
        .await
        .map_err(|e| format!("解析历史弹幕失败: {}", e))?;

    let mut items = Vec::new();
    if let Some(data) = res.data {
        for raw in data.room.iter() {
            items.push(parse_history_item(raw));
        }
    }

    debug!("[api] gethistory room={room_id} -> {} messages", items.len());
    Ok(items)
}

// ── 获取历史记录列表 ──────────────────────────────────

/// 获取 B 站直播观看历史记录
/// 接口: `x/web-interface/history/cursor`，固定 type=live, ps=30
#[tauri::command]
pub async fn get_history_list(
    cookie_store: State<'_, CookieStore>,
) -> Result<Vec<HistoryItem>, String> {
    let auth = {
        let guard = cookie_store.auth.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut req = reqwest::Client::new()
        .get("https://api.bilibili.com/x/web-interface/history/cursor")
        .query(&[("type", "live"), ("ps", "30")]);

    if let Some(ref a) = auth {
        let cookie_str = utils::build_cookie_header(&a.cookies);
        req = req.header("Cookie", cookie_str);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("请求历史记录失败: {}", e))?
        .json::<HistoryCursorResRaw>()
        .await
        .map_err(|e| format!("解析历史记录失败: {}", e))?;

    match res.data {
        Some(data) => {
            let list: Vec<HistoryItem> = data
                .list
                .into_iter()
                .map(|raw| HistoryItem {
                    title: raw.title,
                    cover: raw.cover,
                    author_name: raw.author_name,
                    author_face: raw.author_face,
                    author_mid: raw.author_mid,
                    view_at: raw.view_at,
                    tag_name: raw.tag_name,
                    room_id: raw.history.map_or(0, |h| h.oid),
                    live_status: raw.live_status,
                })
                .collect();

            Ok(list)
        }
        None => {
            handle_error_code(res.code, &cookie_store);
            if res.code == -101 {
                Err("未登录，无法获取历史记录".into())
            } else {
                Err(format!("历史记录接口返回空数据, code={}", res.code))
            }
        }
    }
}

// ── 进入房间上报 ──────────────────────────────────────

/// 通知 B 站服务器用户进入了直播间，才会在服务器端生成历史记录
/// 使用 B 站网页端同款 xlive 接口（POST + Origin 头）
#[tauri::command]
pub async fn record_room_entry(
    room_id: u64,
    cookie_store: State<'_, CookieStore>,
) -> Result<(), String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let auth = {
        let guard = cookie_store.auth.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let csrf = auth
        .as_ref()
        .and_then(|a| a.cookies.get("bili_jct"))
        .cloned()
        .unwrap_or_default();

    debug!("[room_entry] csrf token: '{}'", csrf);

    let mut params = std::collections::HashMap::new();
    params.insert("room_id".to_string(), room_id.to_string());
    params.insert("platform".to_string(), "web".to_string());
    params.insert("csrf".to_string(), csrf.clone());
    params.insert("csrf_token".to_string(), csrf);
    params.insert("ts".to_string(), ts.to_string());

    let mut req = reqwest::Client::new()
        .post("https://api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction")
        .header("Origin", "https://live.bilibili.com")
        .header("Referer", "https://live.bilibili.com/")
        .form(&params);

    if let Some(ref a) = auth {
        req = req.header("Cookie", utils::build_cookie_header(&a.cookies));
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("房间进入上报失败: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析上报响应失败: {}", e))?;

    let code = res.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    if code != 0 {
        warn!("[room_entry] room={room_id} 上报失败, code={code}, resp={res}");
    } else {
        debug!("[room_entry] room={room_id} 上报成功");
    }
    Ok(())
}
