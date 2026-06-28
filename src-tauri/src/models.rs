use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::live_ws::{EmoticonInfo, MedalInfo};

// ── 生成二维码 ────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct QrcodeData {
    pub url: String,
    pub qrcode_key: String,
}

#[derive(Serialize, Deserialize)]
pub struct LoginQrcodeRes {
    pub code: i32,
    pub message: Option<String>,
    pub data: Option<QrcodeData>,
}

// ── 轮询登录状态 ──────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct QrcodeStatusRes {
    /// "pending" | "scanned" | "success" | "expired"
    pub status: String,
    pub message: String,
}

/// B 站 poll 接口返回（内层 data.code 是轮询状态码）
#[derive(Serialize, Deserialize)]
pub(crate) struct PollData {
    pub(crate) url: Option<String>,
    pub(crate) refresh_token: Option<String>,
    pub(crate) code: i32,
    pub(crate) message: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct BiliPollRes {
    pub(crate) code: i32,
    pub(crate) message: Option<String>,
    pub(crate) data: Option<PollData>,
}

// ── 快速查询登录状态 ──────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct LoginStatusRes {
    pub logged_in: bool,
    pub needs_refresh: bool,
    pub message: String,
}

// ── 导航栏用户信息 ────────────────────────────────────

/// 返回给前端的用户信息
#[derive(Serialize, Clone)]
pub struct NavUserInfo {
    pub is_login: bool,
    pub face: String,
    pub mid: u64,
    pub uname: String,
    pub level_info: NavLevelInfo,
}

#[derive(Serialize, Clone)]
pub struct NavLevelInfo {
    pub current_level: u32,
    pub current_exp: i64,
    pub next_exp: String, // Lv6 时为 "--"
}

/// 反序列化 nav 接口原始响应（只取需要的字段）
#[derive(Deserialize)]
pub(crate) struct NavDataRaw {
    #[serde(rename = "isLogin", default)]
    #[allow(dead_code)]
    pub(crate) is_login: bool,
    #[serde(default)]
    pub(crate) face: String,
    #[serde(default)]
    pub(crate) mid: u64,
    #[serde(default)]
    pub(crate) uname: String,
    #[serde(default)]
    pub(crate) level_info: Option<NavLevelInfoRaw>,
}

#[derive(Deserialize)]
pub(crate) struct NavLevelInfoRaw {
    #[serde(default)]
    pub(crate) current_level: u32,
    #[serde(default)]
    pub(crate) current_exp: i64,
    #[serde(default)]
    pub(crate) next_exp: serde_json::Value, // 可能是数字也可能是 "--" 字符串
}

#[derive(Deserialize)]
pub(crate) struct NavResRaw {
    pub(crate) code: i32,
    pub(crate) data: Option<NavDataRaw>,
}

// ── 关注 UP 正在直播列表 ────────────────────────────

/// 返回给前端的单条在播 UP 信息
#[derive(Serialize, Clone)]
pub struct FollowingLiveItem {
    pub room_id: u64,
    pub uid: u64,
    pub uname: String,
    pub face: String,
    pub title: String,
    pub online: u32,
    pub live_status: u32,            // 1=直播中, 2=轮播中
    pub live_time: u64,              // 已播时长(秒), hit_ab=true 时为 0
    pub area_name: String,           // 一级分区
    pub area_v2_name: String,        // 二级分区
    pub area_v2_parent_name: String, // 父分区名
    pub tag_name: String,            // 标签
    pub cover_url: String,           // 直播间封面（来自批量查询补齐）
    pub keyframe: String,            // 关键帧封面
}

/// 在播列表结果
#[derive(Serialize, Clone)]
pub struct FollowingLivesRes {
    pub live_count: u32, // 在播人数
    pub list: Vec<FollowingLiveItem>,
}

/// GetWebList 原始响应的单条数据
#[derive(Deserialize)]
pub(crate) struct WebListItemRaw {
    #[serde(default)]
    pub(crate) room_id: u64,
    #[serde(default)]
    pub(crate) uid: u64,
    #[serde(default)]
    pub(crate) uname: String,
    #[serde(default)]
    pub(crate) face: String,
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) live_status: u32,
    #[serde(default)]
    pub(crate) live_time: u64,
    #[serde(default)]
    pub(crate) area_name: String,
    #[serde(default)]
    pub(crate) area_v2_name: String,
    #[serde(default)]
    pub(crate) area_v2_parent_name: String,
    #[serde(default)]
    pub(crate) tag_name: String,
}

#[derive(Deserialize)]
pub(crate) struct WebListDataRaw {
    #[serde(default)]
    pub(crate) list: Vec<WebListItemRaw>,
}

#[derive(Deserialize)]
pub(crate) struct WebListResRaw {
    pub(crate) code: i32,
    pub(crate) data: Option<WebListDataRaw>,
}

// ── 批量查询直播间状态 ────────────────────────────────

/// 批量查询接口返回的单条数据
#[derive(Deserialize)]
pub(crate) struct BatchRoomRaw {
    #[serde(default)]
    pub(crate) online: u32,
    #[serde(default)]
    pub(crate) cover_from_user: String,
    #[serde(default)]
    pub(crate) keyframe: String,
}

#[derive(Deserialize)]
pub(crate) struct BatchStatusResRaw {
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) code: i32,
    pub(crate) data: Option<HashMap<String, BatchRoomRaw>>,
}

// ── 获取直播间视频流地址 ──────────────────────────────

/// 返回给前端的播放地址数据
#[derive(Serialize, Clone)]
pub struct LivePlayUrlData {
    pub url: String,
    pub current_qn: u32,
    pub quality_desc: String,
}

#[derive(Serialize, Clone)]
pub struct LivePlayUrlRes {
    pub code: i32,
    pub message: Option<String>,
    pub data: Option<LivePlayUrlData>,
}

/// getRoomPlayInfo 原始响应（反序列化用）

/// URL 信息（host + extra 用于拼接完整播放地址）
#[derive(Deserialize)]
pub(crate) struct UrlInfoRaw {
    pub(crate) host: String,
    pub(crate) extra: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) stream_ttl: u32,
}

/// 编码器信息
#[derive(Deserialize)]
pub(crate) struct CodecRaw {
    pub(crate) codec_name: String,
    pub(crate) current_qn: u32,
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) accept_qn: Vec<u32>,
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) url_info: Vec<UrlInfoRaw>,
}

/// 容器格式
#[derive(Deserialize)]
pub(crate) struct FormatRaw {
    pub(crate) format_name: String,
    #[serde(default)]
    pub(crate) codec: Vec<CodecRaw>,
}

/// 流协议
#[derive(Deserialize)]
pub(crate) struct StreamRaw {
    pub(crate) protocol_name: String,
    #[serde(default)]
    pub(crate) format: Vec<FormatRaw>,
}

/// 画质描述
#[derive(Deserialize)]
pub(crate) struct GQnDescRaw {
    pub(crate) qn: u32,
    pub(crate) desc: String,
}

/// playurl 对象（playurl_info 内部）
#[derive(Deserialize)]
pub(crate) struct PlayUrlInnerRaw {
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) cid: u64,
    #[serde(default)]
    pub(crate) g_qn_desc: Vec<GQnDescRaw>,
    #[serde(default)]
    pub(crate) stream: Vec<StreamRaw>,
}

/// playurl_info 包装
#[derive(Deserialize)]
pub(crate) struct PlayUrlInfoRaw {
    pub(crate) playurl: PlayUrlInnerRaw,
}

/// data 层
#[derive(Deserialize)]
pub(crate) struct PlayUrlDataRaw {
    pub(crate) playurl_info: PlayUrlInfoRaw,
}

/// 顶层响应
#[derive(Deserialize)]
pub(crate) struct PlayUrlResRaw {
    pub(crate) code: i32,
    #[allow(dead_code)]
    pub(crate) message: Option<String>,
    pub(crate) data: Option<PlayUrlDataRaw>,
}

// ── 获取直播间信息 ────────────────────────────────────

/// 主播信息
#[derive(Serialize, Clone)]
pub struct UserInfo {
    pub uid: u64,
    pub uname: String,
    pub face: String,
}

/// 返回给前端的直播间信息
#[derive(Serialize, Clone)]
pub struct RoomInfo {
    pub uid: u64,
    pub room_id: u64,
    pub online: u32,
    pub live_status: u32, // 0=未开播 1=直播中 2=轮播中
    pub area_name: String,
    pub parent_area_name: String,
    pub title: String,
    pub user_cover: String,
    pub keyframe: String,  // 关键帧
    pub live_time: String, // "YYYY-MM-DD HH:mm:ss"
    pub user_info: Option<UserInfo>,
}

#[derive(Serialize, Clone)]
pub struct RoomInfoRes {
    pub code: i32,
    pub message: String,
    pub data: Option<RoomInfo>,
}

/// 反序列化用原始结构
#[derive(Deserialize)]
pub(crate) struct RoomInfoRaw {
    #[serde(default)]
    pub(crate) uid: u64,
    #[serde(default)]
    pub(crate) room_id: u64,
    #[serde(default)]
    pub(crate) online: u32,
    #[serde(default)]
    pub(crate) live_status: u32,
    #[serde(default)]
    pub(crate) area_name: String,
    #[serde(default)]
    pub(crate) parent_area_name: String,
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) user_cover: String,
    #[serde(default)]
    pub(crate) keyframe: String,
    #[serde(default)]
    pub(crate) live_time: String,
}

#[derive(Deserialize)]
pub(crate) struct RoomInfoResRaw {
    pub(crate) code: i32,
    #[serde(default)]
    pub(crate) message: String,
    pub(crate) data: Option<RoomInfoRaw>,
}

// ── 获取主播信息 ─────────────────────────────────────

#[derive(Deserialize)]
pub(crate) struct MasterInfoRaw {
    #[serde(default)]
    pub(crate) uid: u64,
    #[serde(default)]
    pub(crate) uname: String,
    #[serde(default)]
    pub(crate) face: String,
}

#[derive(Deserialize)]
pub(crate) struct MasterInfoDataRaw {
    #[serde(default)]
    pub(crate) info: Option<MasterInfoRaw>,
}

#[derive(Deserialize)]
pub(crate) struct MasterInfoResRaw {
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) code: i32,
    pub(crate) data: Option<MasterInfoDataRaw>,
}

// ── 获取直播间历史弹幕 ─────────────────────────────

#[derive(Clone, Serialize)]
pub struct HistoryDanmuItem {
    pub text: String,
    pub nickname: String,
    pub timeline: String,
    pub uid: u64,
    pub face: String,
    pub medal: Option<MedalInfo>,
    pub emoticon: Option<EmoticonInfo>,
    #[serde(rename = "type")]
    pub dm_type: String,
}

#[derive(Deserialize)]
pub(crate) struct HistoryDanmuRaw {
    #[serde(default)]
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) nickname: String,
    #[serde(default)]
    pub(crate) timeline: String,
    #[serde(default)]
    pub(crate) uid: u64,
    #[serde(default)]
    pub(crate) emoticon: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) user: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) medal: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub(crate) struct HistoryDataRaw {
    #[serde(default)]
    pub(crate) room: Vec<HistoryDanmuRaw>,
}

#[derive(Deserialize)]
pub(crate) struct HistoryResRaw {
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) code: i32,
    pub(crate) data: Option<HistoryDataRaw>,
}

// ── 获取历史记录列表 ─────────────────────────────────

/// 返回给前端的单条直播历史记录
#[derive(Serialize, Clone)]
pub struct HistoryItem {
    pub title: String,
    pub cover: String,
    pub author_name: String,
    pub author_face: String,
    pub author_mid: u64,
    pub view_at: u64,
    pub tag_name: String,
    /// 直播间 id（取自 history.oid）
    pub room_id: u64,
    /// 直播状态：0=未开播, 1=直播中
    pub live_status: u8,
}

// ── 反序列化用原始结构 ──────────────────────────────

#[derive(Deserialize)]
pub(crate) struct HistoryItemHistoryRaw {
    #[serde(default)]
    pub(crate) oid: u64,
}

#[derive(Deserialize)]
pub(crate) struct HistoryListItemRaw {
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) cover: String,
    #[serde(default)]
    pub(crate) author_name: String,
    #[serde(default)]
    pub(crate) author_face: String,
    #[serde(default)]
    pub(crate) author_mid: u64,
    #[serde(default)]
    pub(crate) view_at: u64,
    #[serde(default)]
    pub(crate) tag_name: String,
    #[serde(default)]
    pub(crate) live_status: u8,
    #[serde(default)]
    pub(crate) history: Option<HistoryItemHistoryRaw>,
}

#[derive(Deserialize)]
pub(crate) struct HistoryCursorDataRaw {
    #[serde(default)]
    pub(crate) list: Vec<HistoryListItemRaw>,
}

#[derive(Deserialize)]
pub(crate) struct HistoryCursorResRaw {
    pub(crate) code: i32,
    pub(crate) data: Option<HistoryCursorDataRaw>,
}
