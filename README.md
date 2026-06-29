# BiliDanLive
![Tauri 2.0](https://img.shields.io/badge/tauri-2.0-yellow?logo=tauri) ![Vue3](https://img.shields.io/badge/vue-3.0-green?logo=vue.js) ![Rust](https://img.shields.io/badge/lang-Rust-orange?logo=rust) ![Platforms](https://img.shields.io/badge/platforms-macos|windows-green)

一个基于 [Tauri 2](https://tauri.app/) 构建的 Bilibili 直播桌面客户端，专注于轻量、美观的直播观看与弹幕互动体验。

## 功能特性

- [x] **扫码登录** - 支持 Bilibili 二维码扫码登录，Cookie 持久化存储，自动管理登录态
- [x] **直播观看** - 获取直播间信息、视频流地址，支持 FLV 流播放（H.264 视频 + AAC 音频）
- [x] **弹幕互动** - 通过 WebSocket 实时接收弹幕、表情弹幕和醒目留言（Super Chat）
- [x] **纯音频模式** - 支持仅播放音频，关闭视频解码和渲染，节省资源
- [x] **关注列表** - 查看关注的 UP 主中正在直播的列表，一键进入直播间
- [x] **观看历史** - 支持已登录用户的服务端历史 + 未登录时的本地历史记录
- [x] **主题定制** - 多套配色方案（粉色/蓝色/绿色/紫色/橙色/灰色等），支持深色模式
- [x] **毛玻璃效果** - macOS HUD 窗口效果，Windows亚克力，透明背景，圆角边框
- [ ] **发送弹幕** - 直播发送弹幕

## 截图预览

| 未进入 | 设置 |
|:---:|:---:|
| <img src="src/assets/screenshot/2026-06-28%2003.09.30.png" width="300" /> | <img src="src/assets/screenshot/2026-06-28%2003.09.58.png" width="300" /> |

| 个人中心 | 直播间 |
|:---:|:---:|
| <img src="src/assets/screenshot/2026-06-28%2003.10.14.png" width="300" /> | <img src="src/assets/screenshot/2026-06-28%2003.10.44.png" width="300" /> |

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 24
- [Rust](https://www.rust-lang.org/) 最新稳定版
- macOS 或 Windows 操作系统

### 开发调试

```bash
# 安装前端依赖
npm install

# 启动 Tauri 开发模式（自动启动 Vite + Tauri 窗口）
npm run tauri dev
```

### 构建打包

```bash
# 构建生产版本
npm run tauri build
```
构建产物位于 `src-tauri/target/release/bundle/`。

## 免责声明

本项目仅用于学习和测试目的，请勿用于任何商业用途或非法用途。使用本项目产生的任何后果由使用者自行承担。

## 许可证

MIT License © 2026 Cerne1Lin
