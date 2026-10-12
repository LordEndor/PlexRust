//! Commands for requesting movies and shows through Seerr (or Overseerr and
//! Jellyseerr). The client is made on first use and kept, so its session
//! cookie is reused.

use std::sync::Arc;

use seerr::{Auth, Browse, Info, MediaType, NewRequest, SeerrClient};
use serde::Serialize;
use serde_json::Value;
use tauri::State;
use tokio::sync::Mutex;

use crate::AppState;
use crate::commands::{CmdResult, err};

#[derive(Clone)]
struct Connection {
    client: Arc<SeerrClient>,
    info: Info,
}

#[derive(Default)]
pub struct SeerrState(Mutex<Option<Connection>>);

impl SeerrState {
    pub async fn forget(&self) {
        *self.0.lock().await = None;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeerrConfig {
    url: String,
    has_api_key: bool,
}

/// Builds a client from what was typed (or saved) and checks it works.
async fn open(state: &AppState, url: &str, api_key: &str) -> CmdResult<Connection> {
    let auth = if api_key.trim().is_empty() {
        let token = state.settings.lock().await.token.clone().ok_or("Sign in to Plex first")?;
        Auth::Plex(token)
    } else {
        Auth::ApiKey(api_key.trim().to_owned())
    };
    let client = Arc::new(SeerrClient::new(url, auth).map_err(err)?);
    let info = client.info().await.map_err(err)?;
    Ok(Connection { client, info })
}

async fn connection(state: &AppState, seerr: &SeerrState) -> CmdResult<Connection> {
    let mut conn = seerr.0.lock().await;
    if let Some(c) = conn.as_ref() {
        return Ok(c.clone());
    }
    let saved = state.settings.lock().await.seerr.clone();
    if saved.url.is_empty() {
        return Err("Requests aren't set up. Add your Seerr server in Settings.".into());
    }
    let c = open(state, &saved.url, &saved.api_key).await?;
    *conn = Some(c.clone());
    Ok(c)
}

#[tauri::command]
pub async fn seerr_config(state: State<'_, AppState>) -> CmdResult<SeerrConfig> {
    let s = state.settings.lock().await;
    Ok(SeerrConfig {
        url: s.seerr.url.clone(),
        has_api_key: !s.seerr.api_key.is_empty(),
    })
}

/// Saves the server once it answers. An empty `api_key` keeps the saved one
/// when the address is unchanged; pass `clear_api_key` to drop it.
#[tauri::command]
pub async fn seerr_connect(
    state: State<'_, AppState>,
    seerr: State<'_, SeerrState>,
    url: String,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
) -> CmdResult<Info> {
    let url = seerr::normalize_url(&url).map_err(err)?;
    let saved = state.settings.lock().await.seerr.clone();
    let key = match api_key.filter(|k| !k.trim().is_empty()) {
        Some(k) => k.trim().to_owned(),
        None if clear_api_key == Some(true) => String::new(),
        None => saved.api_key,
    };
    let conn = open(&state, &url, &key).await?;
    {
        let mut s = state.settings.lock().await;
        s.seerr.url = url;
        s.seerr.api_key = key;
        s.save(&state.settings_path).map_err(err)?;
    }
    let info = conn.info.clone();
    *seerr.0.lock().await = Some(conn);
    Ok(info)
}

#[tauri::command]
pub async fn seerr_disconnect(state: State<'_, AppState>, seerr: State<'_, SeerrState>) -> CmdResult<()> {
    seerr.forget().await;
    let mut s = state.settings.lock().await;
    s.seerr = Default::default();
    s.save(&state.settings_path).map_err(err)
}

#[tauri::command]
pub async fn seerr_info(state: State<'_, AppState>, seerr: State<'_, SeerrState>) -> CmdResult<Info> {
    Ok(connection(&state, &seerr).await?.info)
}

#[tauri::command]
pub async fn seerr_search(
    state: State<'_, AppState>,
    seerr: State<'_, SeerrState>,
    query: String,
    page: Option<u32>,
) -> CmdResult<Value> {
    let c = connection(&state, &seerr).await?;
    c.client.search(&query, page.unwrap_or(1)).await.map_err(err)
}

#[tauri::command]
pub async fn seerr_discover(
    state: State<'_, AppState>,
    seerr: State<'_, SeerrState>,
    row: String,
    page: Option<u32>,
) -> CmdResult<Value> {
    let c = connection(&state, &seerr).await?;
    c.client.discover(&row, page.unwrap_or(1)).await.map_err(err)
}

#[tauri::command]
pub async fn seerr_browse(
    state: State<'_, AppState>,
    seerr: State<'_, SeerrState>,
    media_type: MediaType,
    page: Option<u32>,
    browse: Option<Browse>,
) -> CmdResult<Value> {
    let c = connection(&state, &seerr).await?;
    c.client
        .browse(media_type, page.unwrap_or(1), &browse.unwrap_or_default())
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn seerr_genres(state: State<'_, AppState>, seerr: State<'_, SeerrState>, media_type: MediaType) -> CmdResult<Value> {
    let c = connection(&state, &seerr).await?;
    c.client.genres(media_type).await.map_err(err)
}

#[tauri::command]
pub async fn seerr_details(
    state: State<'_, AppState>,
    seerr: State<'_, SeerrState>,
    media_type: MediaType,
    tmdb_id: u64,
) -> CmdResult<Value> {
    let c = connection(&state, &seerr).await?;
    c.client.details(media_type, tmdb_id).await.map_err(err)
}

#[tauri::command]
pub async fn seerr_quota(state: State<'_, AppState>, seerr: State<'_, SeerrState>) -> CmdResult<Value> {
    let c = connection(&state, &seerr).await?;
    c.client.quota(c.info.user.id).await.map_err(err)
}

#[tauri::command]
pub async fn seerr_request(
    state: State<'_, AppState>,
    seerr: State<'_, SeerrState>,
    request: NewRequest,
) -> CmdResult<Value> {
    let c = connection(&state, &seerr).await?;
    c.client.request(&request).await.map_err(err)
}

#[tauri::command]
pub async fn seerr_requests(state: State<'_, AppState>, seerr: State<'_, SeerrState>) -> CmdResult<Vec<Value>> {
    let c = connection(&state, &seerr).await?;
    c.client.requests(c.info.user.id, 50).await.map_err(err)
}

#[tauri::command]
pub async fn seerr_cancel(state: State<'_, AppState>, seerr: State<'_, SeerrState>, request_id: u64) -> CmdResult<()> {
    let c = connection(&state, &seerr).await?;
    c.client.cancel(request_id).await.map_err(err)
}
