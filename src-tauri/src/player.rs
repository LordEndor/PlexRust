//! Commands behind the player screen. mpv itself is driven from the UI via
//! tauri-plugin-mpv; Rust works out what to play and keeps Plex in sync.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use plex::{Chapter, Marker, Metadata, PreviewIndex, TranscodeOptions};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::commands::{CmdResult, current_server, err};
use crate::settings::TrackChoice;

/// Seek-bar thumbnails for recently played files, served to the UI through
/// `plximg://` (see images.rs).
#[derive(Default)]
pub struct PreviewStore {
    map: Mutex<HashMap<u64, Arc<PreviewIndex>>>,
}

impl PreviewStore {
    pub fn get(&self, part_id: u64) -> Option<Arc<PreviewIndex>> {
        self.map.lock().ok()?.get(&part_id).cloned()
    }

    fn put(&self, part_id: u64, index: Arc<PreviewIndex>) {
        let Ok(mut map) = self.map.lock() else { return };
        // A few MB each; only the file being watched matters.
        if map.len() >= 3 {
            map.clear();
        }
        map.insert(part_id, index);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInfo {
    count: usize,
    interval_ms: u32,
}

/// Fetches the thumbnail index for a file so the seek bar can show previews.
/// `None` when the server has none.
#[tauri::command]
pub async fn load_previews(
    state: State<'_, AppState>,
    store: State<'_, PreviewStore>,
    part_id: u64,
) -> CmdResult<Option<PreviewInfo>> {
    let index = match store.get(part_id) {
        Some(index) => index,
        None => {
            let server = current_server(&state).await?;
            let Some(index) = state.plex.preview_index(&server, part_id).await.map_err(err)? else {
                return Ok(None);
            };
            let index = Arc::new(index);
            store.put(part_id, index.clone());
            index
        }
    };
    Ok((!index.is_empty()).then(|| PreviewInfo { count: index.len(), interval_ms: index.interval_ms }))
}

/// Saves the audio and subtitle picks for a show, for its next episodes.
#[tauri::command]
pub async fn remember_tracks(state: State<'_, AppState>, key: String, choice: TrackChoice) -> CmdResult<()> {
    let mut s = state.settings.lock().await;
    s.tracks.insert(key, choice);
    s.save(&state.settings_path).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtitle {
    url: String,
    title: String,
    language: Option<String>,
}

/// The episode to offer when this one's credits start.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextUp {
    rating_key: String,
    title: String,
    subtitle: String,
    thumb: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackInfo {
    rating_key: String,
    title: String,
    /// Show and episode number for episodes, year for movies.
    subtitle: Option<String>,
    duration_ms: u64,
    view_offset_ms: u64,
    url: String,
    external_subtitles: Vec<Subtitle>,
    markers: Vec<Marker>,
    /// The mpv executable to launch.
    mpv_path: String,
    /// Where mpv writes its log, so failed playback can be diagnosed.
    log_path: String,
    /// Play only the HDR10 base layer and ignore the Dolby Vision data.
    /// Set for profile 7 (UHD Blu-ray), whose enhancement layer mpv can't
    /// use and which otherwise can leave the screen black.
    strip_dolby_vision: bool,
    next: Option<NextUp>,
    /// The file's id on the server, for seek-bar thumbnails.
    part_id: Option<u64>,
    has_previews: bool,
    chapters: Vec<Chapter>,
    /// Remembered tracks are stored under this key: the show for episodes.
    track_key: String,
    remembered_tracks: Option<TrackChoice>,
}

/// mpv ships inside the installer under `mpv/`; in development fall back to
/// whatever `mpv` is on PATH.
fn mpv_path(app: &AppHandle) -> String {
    let bundled: Option<PathBuf> = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("mpv").join(if cfg!(windows) { "mpv.exe" } else { "mpv" }));
    match bundled {
        Some(p) if p.exists() => p.to_string_lossy().into_owned(),
        _ => "mpv".into(),
    }
}

fn log_path(app: &AppHandle) -> String {
    app.path()
        .app_log_dir()
        .ok()
        .and_then(|d| std::fs::create_dir_all(&d).ok().map(|_| d.join("mpv.log")))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn episode_label(item: &Metadata) -> String {
    format!(
        "{} · S{} · E{}",
        item.grandparent_title.clone().unwrap_or_default(),
        item.parent_index.unwrap_or_default(),
        item.index.unwrap_or_default()
    )
}

#[tauri::command]
pub async fn playback_info(app: AppHandle, state: State<'_, AppState>, rating_key: String) -> CmdResult<PlaybackInfo> {
    let server = current_server(&state).await?;
    let item = state
        .plex
        .metadata(&server, &rating_key)
        .await
        .map_err(err)?
        .ok_or("That item no longer exists on the server")?;
    let part = item
        .media
        .first()
        .and_then(|m| m.part.first())
        .ok_or("This item has no playable file")?;
    let key = part.key.as_deref().ok_or("This item has no playable file")?;

    let external_subtitles = part
        .stream
        .iter()
        .filter(|s| s.stream_type == Some(3))
        .filter_map(|s| {
            Some(Subtitle {
                url: state.plex.direct_url(&server, s.key.as_deref()?),
                title: s
                    .display_title
                    .clone()
                    .or_else(|| s.title.clone())
                    .unwrap_or_else(|| "External".into()),
                language: s.language_code.clone(),
            })
        })
        .collect();

    let strip_dolby_vision = part
        .stream
        .iter()
        .any(|s| s.stream_type == Some(1) && s.dovi_profile == Some(7));

    let track_key = item.grandparent_rating_key.clone().unwrap_or_else(|| item.rating_key.clone());

    let subtitle = match item.kind.as_str() {
        "episode" => Some(episode_label(&item)),
        _ => item.year.map(|y| y.to_string()),
    };

    // Missing next-episode info only costs the Up Next card, so errors are dropped.
    let next = match item.kind.as_str() {
        "episode" => state.plex.next_episode(&server, &item).await.ok().flatten().map(|n| NextUp {
            subtitle: episode_label(&n),
            rating_key: n.rating_key,
            title: n.title,
            thumb: n.thumb,
        }),
        _ => None,
    };

    Ok(PlaybackInfo {
        url: state.plex.direct_url(&server, key),
        rating_key: item.rating_key,
        title: item.title,
        subtitle,
        duration_ms: item.duration.unwrap_or_default(),
        view_offset_ms: item.view_offset.unwrap_or_default(),
        external_subtitles,
        markers: item.markers,
        mpv_path: mpv_path(&app),
        log_path: log_path(&app),
        strip_dolby_vision,
        next,
        part_id: part.id,
        has_previews: part.indexes.as_deref() == Some("sd"),
        chapters: item.chapters.clone(),
        remembered_tracks: state.settings.lock().await.tracks.get(&track_key).cloned(),
        track_key,
    })
}

#[tauri::command]
pub async fn transcode_url(
    state: State<'_, AppState>,
    rating_key: String,
    max_bitrate_kbps: u32,
    resolution: String,
    offset_secs: f64,
    session: String,
) -> CmdResult<String> {
    let server = current_server(&state).await?;
    let opts = TranscodeOptions { max_bitrate_kbps, resolution, offset_secs, session };
    Ok(state.plex.transcode_url(&server, &rating_key, &opts))
}

#[tauri::command]
pub async fn stop_transcode(state: State<'_, AppState>, session: String) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.stop_transcode(&server, &session).await.map_err(err)
}

/// Reports playback position. On `stopped` past 90% the item is also marked
/// watched, matching Plex's own players.
#[tauri::command]
pub async fn report_progress(
    state: State<'_, AppState>,
    rating_key: String,
    playback_state: String,
    time_ms: u64,
    duration_ms: u64,
) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state
        .plex
        .timeline(&server, &rating_key, &playback_state, time_ms, duration_ms)
        .await
        .map_err(err)?;
    if playback_state == "stopped" && duration_ms > 0 && time_ms * 10 >= duration_ms * 9 {
        state.plex.scrobble(&server, &rating_key).await.map_err(err)?;
    }
    Ok(())
}
