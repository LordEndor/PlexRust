//! Commands behind the player screen. mpv itself is driven from the UI via
//! tauri-plugin-mpv; Rust works out what to play and keeps Plex in sync.

use std::path::PathBuf;

use plex::{Marker, TranscodeOptions};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::commands::{CmdResult, current_server, err};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtitle {
    url: String,
    title: String,
    language: Option<String>,
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

    let subtitle = match item.kind.as_str() {
        "episode" => Some(format!(
            "{} · S{} · E{}",
            item.grandparent_title.clone().unwrap_or_default(),
            item.parent_index.unwrap_or_default(),
            item.index.unwrap_or_default()
        )),
        _ => item.year.map(|y| y.to_string()),
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
