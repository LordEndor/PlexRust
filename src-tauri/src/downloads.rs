//! Commands for the Downloads screen, read from qBittorrent's Web UI. The
//! client is made on first use and kept, so its session and the list built
//! from `/sync/maindata` carry over between calls.

use std::sync::Arc;

use qbit::{Action, QbitClient, Snapshot, Sync, Version};
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::AppState;
use crate::commands::{CmdResult, err};
use crate::settings::QbitSettings;

struct Connection {
    client: Arc<QbitClient>,
    sync: Sync,
}

#[derive(Default)]
pub struct DownloadsState(Mutex<Option<Connection>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QbitConfig {
    url: String,
    username: String,
    has_password: bool,
}

async fn client(state: &AppState, downloads: &DownloadsState) -> CmdResult<Arc<QbitClient>> {
    let mut conn = downloads.0.lock().await;
    if let Some(c) = conn.as_ref() {
        return Ok(c.client.clone());
    }
    let saved = state.settings.lock().await.qbittorrent.clone();
    if saved.url.is_empty() {
        return Err("Downloads aren't set up. Add qBittorrent in Settings.".into());
    }
    let client = Arc::new(QbitClient::new(&saved.url, &saved.username, &saved.password).map_err(err)?);
    *conn = Some(Connection { client: client.clone(), sync: Sync::default() });
    Ok(client)
}

#[tauri::command]
pub async fn qbit_config(state: State<'_, AppState>) -> CmdResult<QbitConfig> {
    let s = state.settings.lock().await;
    Ok(QbitConfig {
        url: s.qbittorrent.url.clone(),
        username: s.qbittorrent.username.clone(),
        has_password: !s.qbittorrent.password.is_empty(),
    })
}

/// Saves qBittorrent once it answers. An empty `password` keeps the saved
/// one unless the username changed.
#[tauri::command]
pub async fn qbit_connect(
    state: State<'_, AppState>,
    downloads: State<'_, DownloadsState>,
    url: String,
    username: String,
    password: Option<String>,
) -> CmdResult<Version> {
    let url = qbit::normalize_url(&url).map_err(err)?;
    let username = username.trim().to_owned();
    let password = match password.filter(|p| !p.is_empty()) {
        Some(p) => p,
        None => {
            let saved = state.settings.lock().await.qbittorrent.clone();
            if saved.username == username { saved.password } else { String::new() }
        }
    };
    let client = Arc::new(QbitClient::new(&url, &username, &password).map_err(err)?);
    let version = client.version().await.map_err(err)?;
    let mut s = state.settings.lock().await;
    s.qbittorrent = QbitSettings { url, username, password };
    s.save(&state.settings_path).map_err(err)?;
    *downloads.0.lock().await = Some(Connection { client, sync: Sync::default() });
    Ok(version)
}

#[tauri::command]
pub async fn qbit_disconnect(state: State<'_, AppState>, downloads: State<'_, DownloadsState>) -> CmdResult<()> {
    *downloads.0.lock().await = None;
    let mut s = state.settings.lock().await;
    s.qbittorrent = QbitSettings::default();
    s.save(&state.settings_path).map_err(err)
}

/// Every torrent with speeds and free space, as of now.
#[tauri::command]
pub async fn downloads_list(state: State<'_, AppState>, downloads: State<'_, DownloadsState>) -> CmdResult<Snapshot> {
    client(&state, &downloads).await?;
    // Held across the call, so two screens asking at once don't mix up the
    // update ids.
    let mut conn = downloads.0.lock().await;
    let c = conn.as_mut().ok_or("Downloads aren't set up. Add qBittorrent in Settings.")?;
    let client = c.client.clone();
    client.sync(&mut c.sync).await.map_err(err)?;
    Ok(c.sync.snapshot())
}

#[tauri::command]
pub async fn downloads_action(
    state: State<'_, AppState>,
    downloads: State<'_, DownloadsState>,
    action: Action,
    hashes: Vec<String>,
) -> CmdResult<()> {
    client(&state, &downloads).await?.act(action, &hashes).await.map_err(err)
}

#[tauri::command]
pub async fn downloads_toggle_alt_speed(
    state: State<'_, AppState>,
    downloads: State<'_, DownloadsState>,
) -> CmdResult<()> {
    client(&state, &downloads).await?.toggle_alt_speed().await.map_err(err)
}
