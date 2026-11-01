//! Commands for the upcoming-releases calendar, read from Radarr (movies)
//! and Sonarr (episodes). Clients hold no session, so one is made per call
//! from the saved settings.

use arr::{ArrClient, Kind, Release, Status};
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::commands::{CmdResult, err};
use crate::settings::{ArrSettings, Settings};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    url: String,
    has_api_key: bool,
}

#[derive(Serialize)]
pub struct ArrConfig {
    radarr: ServerConfig,
    sonarr: ServerConfig,
}

#[derive(Serialize)]
pub struct SourceError {
    source: Kind,
    message: String,
}

/// Releases from every server that answered, plus what went wrong with the
/// others, so one server being down doesn't empty the calendar.
#[derive(Serialize)]
pub struct Calendar {
    releases: Vec<Release>,
    errors: Vec<SourceError>,
}

fn saved(s: &mut Settings, kind: Kind) -> &mut ArrSettings {
    match kind {
        Kind::Radarr => &mut s.radarr,
        Kind::Sonarr => &mut s.sonarr,
    }
}

fn config(s: &ArrSettings) -> ServerConfig {
    ServerConfig { url: s.url.clone(), has_api_key: !s.api_key.is_empty() }
}

#[tauri::command]
pub async fn arr_config(state: State<'_, AppState>) -> CmdResult<ArrConfig> {
    let s = state.settings.lock().await;
    Ok(ArrConfig { radarr: config(&s.radarr), sonarr: config(&s.sonarr) })
}

/// Saves the server once it answers. An empty `api_key` keeps the saved one.
#[tauri::command]
pub async fn arr_connect(
    state: State<'_, AppState>,
    kind: Kind,
    url: String,
    api_key: Option<String>,
) -> CmdResult<Status> {
    let url = arr::normalize_url(&url).map_err(err)?;
    let key = match api_key.filter(|k| !k.trim().is_empty()) {
        Some(k) => k.trim().to_owned(),
        None => saved(&mut *state.settings.lock().await, kind).api_key.clone(),
    };
    if key.is_empty() {
        return Err(format!("Enter the API key from {kind} under Settings, General."));
    }
    let status = ArrClient::new(kind, &url, &key).map_err(err)?.status().await.map_err(err)?;
    let mut s = state.settings.lock().await;
    *saved(&mut s, kind) = ArrSettings { url, api_key: key };
    s.save(&state.settings_path).map_err(err)?;
    Ok(status)
}

#[tauri::command]
pub async fn arr_disconnect(state: State<'_, AppState>, kind: Kind) -> CmdResult<()> {
    let mut s = state.settings.lock().await;
    *saved(&mut s, kind) = ArrSettings::default();
    s.save(&state.settings_path).map_err(err)
}

/// Releases between `start` and `end` (`YYYY-MM-DD`) from both servers.
#[tauri::command]
pub async fn arr_calendar(state: State<'_, AppState>, start: String, end: String) -> CmdResult<Calendar> {
    let servers = {
        let s = state.settings.lock().await;
        [(Kind::Radarr, s.radarr.clone()), (Kind::Sonarr, s.sonarr.clone())]
    };
    let (radarr, sonarr) = tokio::join!(
        fetch(Kind::Radarr, &servers[0].1, &start, &end),
        fetch(Kind::Sonarr, &servers[1].1, &start, &end),
    );
    let mut calendar = Calendar { releases: Vec::new(), errors: Vec::new() };
    for (source, result) in [radarr, sonarr].into_iter().flatten() {
        match result {
            Ok(releases) => calendar.releases.extend(releases),
            Err(e) => calendar.errors.push(SourceError { source, message: e.to_string() }),
        }
    }
    calendar.releases.sort_by(|a, b| {
        (&a.date, &a.air_date_utc, &a.title, a.episode_number).cmp(&(&b.date, &b.air_date_utc, &b.title, b.episode_number))
    });
    Ok(calendar)
}

/// None when the server isn't set up.
async fn fetch(kind: Kind, c: &ArrSettings, start: &str, end: &str) -> Option<(Kind, arr::Result<Vec<Release>>)> {
    if c.url.is_empty() {
        return None;
    }
    let result = match ArrClient::new(kind, &c.url, &c.api_key) {
        Ok(client) => client.calendar(start, end).await,
        Err(e) => Err(e),
    };
    Some((kind, result))
}
