//! Commands for the Downloads screen, read from qBittorrent's Web UI. The
//! client is made on first use and kept, so its session and the list built
//! from `/sync/maindata` carry over between calls.
//!
//! Each torrent Radarr or Sonarr is fetching is matched to its movie or
//! episodes through their download queue, by info hash.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use arr::{ArrClient, Kind, QueueItem, ReleaseKind};
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
pub struct DownloadsState(Mutex<Option<Connection>>, Mutex<Option<(Instant, HashMap<String, Media>)>>);

/// The Radarr and Sonarr queues change slowly; they're asked again after this.
const QUEUE_MAX_AGE: Duration = Duration::from_secs(15);

/// The movie or episodes behind one download.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    kind: ReleaseKind,
    title: String,
    year: Option<u32>,
    poster: Option<String>,
    tmdb_id: Option<u64>,
    tvdb_id: Option<u64>,
    season_number: Option<u32>,
    /// Sorted; several for a season pack.
    episodes: Vec<u32>,
    /// Only when the download is one episode.
    episode_title: Option<String>,
    /// Radarr's or Sonarr's import state, such as `downloading` or `imported`.
    state: Option<String>,
}

#[derive(Serialize)]
pub struct DownloadsList {
    #[serde(flatten)]
    snapshot: Snapshot,
    /// By torrent hash.
    media: HashMap<String, Media>,
}

fn group(items: Vec<QueueItem>) -> HashMap<String, Media> {
    let mut media: HashMap<String, Media> = HashMap::new();
    for q in items {
        let entry = media.entry(q.download_id.clone()).or_insert_with(|| Media {
            kind: q.kind,
            title: q.title.clone(),
            year: q.year,
            poster: q.poster.clone(),
            tmdb_id: q.tmdb_id,
            tvdb_id: q.tvdb_id,
            season_number: q.season_number,
            episodes: Vec::new(),
            episode_title: q.episode_title.clone(),
            state: q.state.clone(),
        });
        if entry.season_number != q.season_number {
            // A pack across seasons: no single season to name.
            entry.season_number = None;
        }
        if let Some(n) = q.episode_number
            && !entry.episodes.contains(&n)
        {
            entry.episodes.push(n);
        }
    }
    for m in media.values_mut() {
        m.episodes.sort_unstable();
        if m.episodes.len() > 1 {
            m.episode_title = None;
        }
    }
    media
}

/// Both queues merged, from the cache when it's fresh. A server that's down
/// or not set up adds nothing.
async fn queue(state: &AppState, downloads: &DownloadsState) -> HashMap<String, Media> {
    if let Some((at, media)) = downloads.1.lock().await.as_ref()
        && at.elapsed() < QUEUE_MAX_AGE
    {
        return media.clone();
    }
    let servers = {
        let s = state.settings.lock().await;
        [(Kind::Radarr, s.radarr.clone()), (Kind::Sonarr, s.sonarr.clone())]
    };
    let fetch = |kind: Kind, url: String, key: String| async move {
        if url.is_empty() {
            return Vec::new();
        }
        match ArrClient::new(kind, &url, &key) {
            Ok(client) => client.queue().await.unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    };
    let [(_, radarr), (_, sonarr)] = servers;
    let (movies, episodes) = tokio::join!(
        fetch(Kind::Radarr, radarr.url, radarr.api_key),
        fetch(Kind::Sonarr, sonarr.url, sonarr.api_key),
    );
    let media = group(movies.into_iter().chain(episodes).collect());
    *downloads.1.lock().await = Some((Instant::now(), media.clone()));
    media
}

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

/// Every torrent with speeds and free space, as of now, and the movies and
/// episodes Radarr and Sonarr know them as.
#[tauri::command]
pub async fn downloads_list(
    state: State<'_, AppState>,
    downloads: State<'_, DownloadsState>,
) -> CmdResult<DownloadsList> {
    client(&state, &downloads).await?;
    let snapshot = {
        // Held across the call, so two screens asking at once don't mix up
        // the update ids.
        let mut conn = downloads.0.lock().await;
        let c = conn.as_mut().ok_or("Downloads aren't set up. Add qBittorrent in Settings.")?;
        let client = c.client.clone();
        client.sync(&mut c.sync).await.map_err(err)?;
        c.sync.snapshot()
    };
    let mut media = queue(&state, &downloads).await;
    media.retain(|hash, _| snapshot.torrents.iter().any(|t| &t.hash == hash));
    Ok(DownloadsList { snapshot, media })
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
