use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use log::{debug, trace};
use lru::LruCache;
use md5::Digest;

// ── XOR 混淆密钥 ─────────────────────────────────

const XOR_KEY: &[u8] = b"BiliDanImgCacheKey2026";

fn xor(data: &[u8]) -> Vec<u8> {
    data.iter()
        .enumerate()
        .map(|(i, &b)| b ^ XOR_KEY[i % XOR_KEY.len()])
        .collect()
}

// ── ImageCache ────────────────────────────────────

/// 两级图片缓存：内存 LRU + 磁盘（XOR 混淆）
pub struct ImageCache {
    mem: Mutex<LruCache<String, String>>,
    disk_dir: PathBuf,
    max_disk_bytes: u64,
}

impl ImageCache {
    pub fn new(disk_dir: PathBuf, mem_cap: usize, max_disk_mb: u64) -> Self {
        std::fs::create_dir_all(&disk_dir).ok();
        debug!(
            "[img-cache] 初始化: mem_cap={mem_cap}, max_disk_mb={max_disk_mb}, dir={}",
            disk_dir.display()
        );
        ImageCache {
            mem: Mutex::new(LruCache::new(NonZeroUsize::new(mem_cap).unwrap())),
            disk_dir,
            max_disk_bytes: max_disk_mb * 1024 * 1024,
        }
    }

    fn file_path(&self, url: &str) -> PathBuf {
        let hash = format!("{:x}", md5::Md5::digest(url.as_bytes()));
        self.disk_dir.join(hash)
    }

    /// 读取：L1 → L2 磁盘（异步读）
    pub async fn get(&self, url: &str) -> Option<String> {
        // L1 内存
        {
            let mut mem = self.mem.lock().unwrap();
            if let Some(data_url) = mem.get(url) {
                return Some(data_url.clone());
            }
        }

        // L2 磁盘（异步）
        let path = self.file_path(url);
        trace!("[img-cache] mem miss, trying disk for {}", url);
        let obf_bytes = tokio::fs::read(&path).await.ok()?;
        if obf_bytes.is_empty() {
            return None;
        }
        let ct_len = obf_bytes[0] as usize;
        if ct_len + 1 > obf_bytes.len() {
            return None;
        }
        let content_type_bytes = &obf_bytes[1..1 + ct_len];
        let img_bytes = &obf_bytes[1 + ct_len..];

        let content_type = String::from_utf8_lossy(&xor(content_type_bytes)).to_string();
        let raw = xor(img_bytes);

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&raw);
        let data_url = format!("data:{};base64,{}", content_type, b64);

        // 回写 L1
        {
            let mut mem = self.mem.lock().unwrap();
            mem.put(url.to_string(), data_url.clone());
        }

        trace!("[img-cache] disk hit for {}", url);
        Some(data_url)
    }

    /// 仅内存读取（同步，不落盘）
    pub fn get_mem(&self, url: &str) -> Option<String> {
        let mut mem = self.mem.lock().unwrap();
        mem.get(url).cloned()
    }

    /// 仅内存写入（同步，不落盘，不触发淘汰检查）
    pub fn put_mem(&self, url: String, content_type: String, raw_bytes: &[u8]) -> String {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(raw_bytes);
        let data_url = format!("data:{};base64,{}", content_type, b64);
        let mut mem = self.mem.lock().unwrap();
        mem.put(url, data_url.clone());
        data_url
    }

    /// 写入：L1 + L2 磁盘（异步写） + 淘汰检查
    pub async fn put(&self, url: String, content_type: String, raw_bytes: &[u8]) -> String {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(raw_bytes);
        let data_url = format!("data:{};base64,{}", content_type, b64);

        // L1
        {
            let mut mem = self.mem.lock().unwrap();
            mem.put(url.clone(), data_url.clone());
        }

        // L2 磁盘（异步写）
        let path = self.file_path(&url);
        let ct_bytes = content_type.as_bytes();
        let mut obf = Vec::with_capacity(1 + ct_bytes.len() + raw_bytes.len());
        obf.push(ct_bytes.len() as u8);
        obf.extend_from_slice(&xor(ct_bytes));
        obf.extend_from_slice(&xor(raw_bytes));

        tokio::fs::write(&path, &obf).await.ok();

        // 淘汰检查（spawn_blocking 避免阻塞）
        let disk_dir = self.disk_dir.clone();
        let max_bytes = self.max_disk_bytes;
        tokio::task::spawn_blocking(move || {
            let entries = collect_disk_entries(&disk_dir).unwrap_or_default();
            let total: u64 = entries.iter().map(|e| e.size).sum();
            if total <= max_bytes {
                return;
            }
            let mut sorted = entries;
            sorted.sort_by_key(|e| e.mtime);
            let remove_count = (sorted.len() / 3).max(1);
            debug!(
                "[img-cache] 磁盘淘汰: 删除 {remove_count} 个文件 (最旧), 当前总量 {total} bytes > {max_bytes} bytes 上限"
            );
            for entry in sorted.iter().take(remove_count) {
                std::fs::remove_file(&entry.path).ok();
            }
        });

        data_url
    }
}

// ── 磁盘条目 ──────────────────────────────────────

struct DiskEntry {
    path: PathBuf,
    size: u64,
    mtime: SystemTime,
}

fn collect_disk_entries(dir: &std::path::Path) -> Result<Vec<DiskEntry>, std::io::Error> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_file() {
            entries.push(DiskEntry {
                path: entry.path(),
                size: meta.len(),
                mtime: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            });
        }
    }
    Ok(entries)
}
