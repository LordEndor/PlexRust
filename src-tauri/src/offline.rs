//! Movies and episodes copied to this computer, to watch without the server
//! (on a train, say). Files are the originals, saved in the app's data folder
//! with a manifest next to them. Watch progress made offline is kept here and
//! sent to Plex the next time the server answers.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use plex::{Metadata, ServerConnection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, Semaphore};

use crate::AppState;
use crate::commands::{CmdResult, current_server, err};

const MANIFEST: &str = "offline.json";
/// Downloads running at once; the rest wait their turn.
const PARALLEL: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Queued,
    Downloading,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineItem {
    pub rating_key: String,
    /// The server it came from; ratingKeys only mean something on one server.
    pub server_id: String,
    /// The item's details as they were when downloaded: titles, markers,
    /// chapters, so the player has everything without the server.
    pub item: Metadata,
    /// File name in the offline folder.
    pub file: String,
    /// Poster file name in the offline folder, if it could be saved.
    pub poster: Option<String>,
    pub status: Status,
    pub error: Option<String>,
    /// Bytes.
    pub size: u64,
    pub downloaded: u64,
    /// Where playback got to, kept here too so it works offline.
    pub view_offset_ms: u64,
    pub watched: bool,
    /// Progress made while the server couldn't be reached, still to send.
    pub pending_sync: bool,
    /// Unix seconds.
    pub added_at: i64,
}

#[derive(Default, Serialize, Deserialize)]
struct Manifest {
    items: BTreeMap<String, OfflineItem>,
}

pub struct OfflineState {
    dir: PathBuf,
    manifest: Mutex<Manifest>,
    cancel: std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>,
    slots: Arc<Semaphore>,
}

fn id(server: &str, rating_key: &str) -> String {
    format!("{server}:{rating_key}")
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// A file name from the title, safe on Windows, unique by rating key.
fn file_name(item: &Metadata, rating_key: &str, ext: &str) -> String {
    let title = match item.kind.as_str() {
        "episode" => format!(
            "{} S{:02}E{:02} {}",
            item.grandparent_title.clone().unwrap_or_default(),
            item.parent_index.unwrap_or_default(),
            item.index.unwrap_or_default(),
            item.title
        ),
        _ => match item.year {
            Some(y) => format!("{} ({y})", item.title),
            None => item.title.clone(),
        },
    };
    let clean: String = title
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean: String = clean.chars().take(120).collect();
    format!("{clean} [{rating_key}].{ext}")
}

impl OfflineState {
    pub fn load(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        let mut manifest: Manifest = std::fs::read_to_string(dir.join(MANIFEST))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        // Downloads cut off by closing the app start again from scratch.
        for item in manifest.items.values_mut() {
            if matches!(item.status, Status::Downloading | Status::Queued) {
                item.status = Status::Failed;
                item.error = Some("Stopped when the app closed".into());
            }
        }
        Self {
            dir,
            manifest: Mutex::new(manifest),
            cancel: Default::default(),
            slots: Arc::new(Semaphore::new(PARALLEL)),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    async fn save(&self) {
        let m = self.manifest.lock().await;
        if let Ok(text) = serde_json::to_string_pretty(&*m) {
            let tmp = self.dir.join(format!("{MANIFEST}.tmp"));
            if std::fs::write(&tmp, text).is_ok() {
                let _ = std::fs::rename(&tmp, self.dir.join(MANIFEST));
            }
        }
    }

    async fn update(&self, key: &str, f: impl FnOnce(&mut OfflineItem)) {
        if let Some(item) = self.manifest.lock().await.items.get_mut(key) {
            f(item);
        }
    }

    /// The downloaded copy of an item, with its saved details, when it's complete.
    pub async fn local(&self, server: &str, rating_key: &str) -> Option<(PathBuf, OfflineItem)> {
        let m = self.manifest.lock().await;
        let item = m.items.get(&id(server, rating_key))?;
        let path = self.dir.join(&item.file);
        (item.status == Status::Done && path.exists()).then(|| (path, item.clone()))
    }

    /// Keeps the offline copy's position in step; `pending` when the server
    /// didn't get it.
    pub async fn record_progress(&self, server: &str, rating_key: &str, time_ms: u64, watched: bool, pending: bool) {
        let key = id(server, rating_key);
        let mut changed = false;
        if let Some(item) = self.manifest.lock().await.items.get_mut(&key) {
            item.view_offset_ms = if watched { 0 } else { time_ms };
            item.watched |= watched;
            item.pending_sync |= pending;
            changed = true;
        }
        if changed {
            self.save().await;
        }
    }
}

/// Every offline item, newest first.
#[tauri::command]
pub async fn offline_list(offline: State<'_, OfflineState>) -> CmdResult<Vec<OfflineItem>> {
    let m = offline.manifest.lock().await;
    let mut items: Vec<_> = m.items.values().cloned().collect();
    items.sort_by(|a, b| b.added_at.cmp(&a.added_at));
    Ok(items)
}

/// Downloads a movie or episode, or every episode of a season or show.
/// Returns how many files were queued.
#[tauri::command]
pub async fn offline_download(
    app: AppHandle,
    state: State<'_, AppState>,
    offline: State<'_, OfflineState>,
    rating_key: String,
) -> CmdResult<usize> {
    let server = current_server(&state).await?;
    let item = state
        .plex
        .metadata(&server, &rating_key)
        .await
        .map_err(err)?
        .ok_or("That item no longer exists on the server")?;
    let mut items = Vec::new();
    match item.kind.as_str() {
        "movie" | "episode" => items.push(item),
        "season" | "show" => {
            let mut seasons = vec![item.clone()];
            if item.kind == "show" {
                seasons = state.plex.children(&server, &item.rating_key).await.map_err(err)?;
            }
            for season in seasons {
                for ep in state.plex.children(&server, &season.rating_key).await.map_err(err)? {
                    // Children lists leave out markers and chapters; fetch each in full.
                    if let Some(full) = state.plex.metadata(&server, &ep.rating_key).await.map_err(err)? {
                        items.push(full);
                    }
                }
            }
        }
        other => return Err(format!("Can't download a {other}")),
    }

    let mut queued = 0;
    for item in items {
        let key = id(&server.machine_id, &item.rating_key);
        {
            let m = offline.manifest.lock().await;
            if m.items.get(&key).is_some_and(|i| i.status != Status::Failed) {
                continue;
            }
        }
        let Some(part) = item.media.first().and_then(|m| m.part.first()) else { continue };
        let Some(part_key) = part.key.clone() else { continue };
        let ext = part.container.clone().unwrap_or_else(|| "mkv".into());
        let entry = OfflineItem {
            rating_key: item.rating_key.clone(),
            server_id: server.machine_id.clone(),
            file: file_name(&item, &item.rating_key, &ext),
            poster: None,
            status: Status::Queued,
            error: None,
            size: part.size.unwrap_or_default(),
            downloaded: 0,
            view_offset_ms: item.view_offset.unwrap_or_default(),
            watched: item.view_count.unwrap_or_default() > 0,
            pending_sync: false,
            added_at: now(),
            item,
        };
        let flag = Arc::new(AtomicBool::new(false));
        offline.cancel.lock().unwrap().insert(key.clone(), flag.clone());
        offline.manifest.lock().await.items.insert(key.clone(), entry);
        let app = app.clone();
        let server = server.clone();
        tauri::async_runtime::spawn(async move {
            let offline = app.state::<OfflineState>();
            let state = app.state::<AppState>();
            let result = download(&state, &offline, &server, &key, &part_key, &flag).await;
            offline.cancel.lock().unwrap().remove(&key);
            if flag.load(Ordering::Relaxed) {
                return;
            }
            offline
                .update(&key, |i| match result {
                    Ok(()) => {
                        i.status = Status::Done;
                        i.downloaded = i.size.max(i.downloaded);
                        i.error = None;
                    }
                    Err(e) => {
                        i.status = Status::Failed;
                        i.error = Some(e);
                    }
                })
                .await;
            offline.save().await;
        });
        queued += 1;
    }
    offline.save().await;
    Ok(queued)
}

async fn download(
    state: &AppState,
    offline: &OfflineState,
    server: &ServerConnection,
    key: &str,
    part_key: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let _slot = offline.slots.clone().acquire_owned().await.map_err(err)?;
    if cancel.load(Ordering::Relaxed) {
        return Ok(());
    }
    offline.update(key, |i| i.status = Status::Downloading).await;
    let (file, thumb) = {
        let m = offline.manifest.lock().await;
        let i = m.items.get(key).ok_or("removed")?;
        let thumb = match i.item.kind.as_str() {
            "episode" => i.item.grandparent_thumb.clone().or_else(|| i.item.thumb.clone()),
            _ => i.item.thumb.clone(),
        };
        (i.file.clone(), thumb)
    };

    // The poster, so the Offline page looks right without the server.
    if let Some(thumb) = thumb {
        if let Ok((bytes, _)) = state.plex.image(server, &thumb, 300, 450).await {
            let name = format!("{}.jpg", file.rsplit_once('.').map_or(file.as_str(), |(n, _)| n));
            if std::fs::write(offline.dir.join(&name), bytes).is_ok() {
                offline.update(key, |i| i.poster = Some(name)).await;
            }
        }
    }

    let url = format!("{}&download=1", state.plex.direct_url(server, part_key));
    let mut resp = state.plex.download(&url).await.map_err(err)?;
    let total = resp.content_length();
    if let Some(total) = total {
        offline.update(key, |i| i.size = total).await;
    }
    let partial = offline.dir.join(format!("{file}.part"));
    let mut out = tokio::fs::File::create(&partial).await.map_err(err)?;
    let mut done: u64 = 0;
    let mut last_report = std::time::Instant::now();
    while let Some(chunk) = resp.chunk().await.map_err(err)? {
        if cancel.load(Ordering::Relaxed) {
            drop(out);
            let _ = tokio::fs::remove_file(&partial).await;
            return Ok(());
        }
        out.write_all(&chunk).await.map_err(err)?;
        done += chunk.len() as u64;
        if last_report.elapsed().as_millis() > 500 {
            last_report = std::time::Instant::now();
            offline.update(key, |i| i.downloaded = done).await;
        }
    }
    out.flush().await.map_err(err)?;
    drop(out);
    if total.is_some_and(|t| t != done) {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err("The download was cut off".into());
    }
    tokio::fs::rename(&partial, offline.dir.join(&file)).await.map_err(err)?;
    offline.update(key, |i| i.downloaded = done).await;
    Ok(())
}

/// Stops a download, or deletes a downloaded copy.
#[tauri::command]
pub async fn offline_delete(offline: State<'_, OfflineState>, server_id: String, rating_key: String) -> CmdResult<()> {
    let key = id(&server_id, &rating_key);
    if let Some(flag) = offline.cancel.lock().unwrap().remove(&key) {
        flag.store(true, Ordering::Relaxed);
    }
    let removed = offline.manifest.lock().await.items.remove(&key);
    if let Some(item) = removed {
        let _ = std::fs::remove_file(offline.dir.join(&item.file));
        let _ = std::fs::remove_file(offline.dir.join(format!("{}.part", item.file)));
        if let Some(poster) = item.poster {
            let _ = std::fs::remove_file(offline.dir.join(poster));
        }
    }
    offline.save().await;
    Ok(())
}

/// Sends progress made offline to Plex. Returns how many items were synced.
#[tauri::command]
pub async fn offline_sync(state: State<'_, AppState>, offline: State<'_, OfflineState>) -> CmdResult<usize> {
    let server = current_server(&state).await?;
    let pending: Vec<OfflineItem> = {
        let m = offline.manifest.lock().await;
        m.items.values().filter(|i| i.pending_sync && i.server_id == server.machine_id).cloned().collect()
    };
    let mut synced = 0;
    for i in pending {
        let duration = i.item.duration.unwrap_or_default();
        let sent = if i.watched {
            state.plex.scrobble(&server, &i.rating_key).await
        } else {
            state.plex.timeline(&server, &i.rating_key, "stopped", i.view_offset_ms, duration).await
        };
        if sent.is_ok() {
            offline.update(&id(&i.server_id, &i.rating_key), |x| x.pending_sync = false).await;
            synced += 1;
        }
    }
    if synced > 0 {
        offline.save().await;
    }
    Ok(synced)
}

/// The folder the files are in, to open in Explorer.
#[tauri::command]
pub async fn offline_folder(offline: State<'_, OfflineState>) -> CmdResult<String> {
    Ok(offline.dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_safe_and_unique() {
        let ep = Metadata {
            kind: "episode".into(),
            title: "Who: Me?".into(),
            grandparent_title: Some("Show/Name".into()),
            parent_index: Some(1),
            index: Some(2),
            ..Default::default()
        };
        assert_eq!(file_name(&ep, "42", "mkv"), "Show Name S01E02 Who Me [42].mkv");
        let movie = Metadata { kind: "movie".into(), title: "Heat".into(), year: Some(1995), ..Default::default() };
        assert_eq!(file_name(&movie, "7", "mp4"), "Heat (1995) [7].mp4");
    }
}
