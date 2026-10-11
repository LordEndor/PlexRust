use std::sync::{Arc, Mutex};
use std::time::Duration;

use plex::{Directory, Filters, Hub, LibrarySection, Metadata, Page, Pin, ServerConnection, User};
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::settings::Prefs;

pub(crate) type CmdResult<T> = Result<T, String>;

pub(crate) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    user: Option<User>,
    server: Option<ServerConnection>,
}

#[tauri::command]
pub async fn get_session(state: State<'_, AppState>) -> CmdResult<Session> {
    let s = state.settings.lock().await;
    Ok(Session {
        user: s.token.as_ref().and(s.user.clone()),
        server: s.server.clone(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStart {
    pin_id: u64,
    code: String,
    url: String,
}

#[tauri::command]
pub async fn auth_start(state: State<'_, AppState>) -> CmdResult<AuthStart> {
    let pin = state.plex.create_pin().await.map_err(err)?;
    Ok(AuthStart {
        url: state.plex.auth_url(&pin),
        pin_id: pin.id,
        code: pin.code,
    })
}

/// Waits for the user to approve the PIN in their browser, then saves the
/// account token.
#[tauri::command]
pub async fn auth_wait(state: State<'_, AppState>, pin_id: u64, code: String) -> CmdResult<User> {
    let pin = Pin { id: pin_id, code, auth_token: None };
    let token = state
        .plex
        .wait_for_token(&pin, Duration::from_secs(10 * 60))
        .await
        .map_err(err)?;
    let user = state.plex.user(&token).await.map_err(err)?;
    let mut s = state.settings.lock().await;
    s.token = Some(token);
    s.user = Some(user.clone());
    s.save(&state.settings_path).map_err(err)?;
    Ok(user)
}

#[tauri::command]
pub async fn sign_out(state: State<'_, AppState>) -> CmdResult<()> {
    let mut s = state.settings.lock().await;
    s.token = None;
    s.user = None;
    s.server = None;
    s.save(&state.settings_path).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSummary {
    machine_id: String,
    name: String,
    owned: bool,
    online: bool,
    version: String,
    platform: Option<String>,
}

async fn account_token(state: &AppState) -> CmdResult<String> {
    state
        .settings
        .lock()
        .await
        .token
        .clone()
        .ok_or_else(|| "Not signed in".to_owned())
}

#[tauri::command]
pub async fn list_servers(state: State<'_, AppState>) -> CmdResult<Vec<ServerSummary>> {
    let token = account_token(&state).await?;
    let servers = state.plex.servers(&token).await.map_err(err)?;
    Ok(servers
        .into_iter()
        .map(|r| ServerSummary {
            machine_id: r.client_identifier,
            name: r.name,
            owned: r.owned,
            online: r.presence,
            version: r.product_version,
            platform: r.platform,
        })
        .collect())
}

#[tauri::command]
pub async fn select_server(state: State<'_, AppState>, machine_id: String) -> CmdResult<ServerConnection> {
    let token = account_token(&state).await?;
    let servers = state.plex.servers(&token).await.map_err(err)?;
    let server = servers
        .iter()
        .find(|r| r.client_identifier == machine_id)
        .ok_or("That server is no longer on your account")?;
    let conn = state.plex.connect(server, &token).await.map_err(err)?;
    let mut s = state.settings.lock().await;
    s.server = Some(conn.clone());
    s.save(&state.settings_path).map_err(err)?;
    Ok(conn)
}

pub(crate) async fn current_server(state: &AppState) -> CmdResult<ServerConnection> {
    state
        .settings
        .lock()
        .await
        .server
        .clone()
        .ok_or_else(|| "No server selected".to_owned())
}

#[tauri::command]
pub async fn library_sections(state: State<'_, AppState>) -> CmdResult<Vec<LibrarySection>> {
    let server = current_server(&state).await?;
    state.plex.library_sections(&server).await.map_err(err)
}

#[tauri::command]
pub async fn home_hubs(state: State<'_, AppState>) -> CmdResult<Vec<Hub>> {
    let server = current_server(&state).await?;
    state.plex.home_hubs(&server).await.map_err(err)
}

/// The last bitrate-filtered library. Plex can't filter on bitrate, so the
/// whole library is fetched once and the grid pages through this copy.
#[derive(Default)]
pub struct FilteredLibrary(Mutex<Option<(String, Arc<Vec<Metadata>>)>>);

#[tauri::command]
pub async fn section_items(
    state: State<'_, AppState>,
    filtered: State<'_, FilteredLibrary>,
    section: String,
    start: u32,
    size: u32,
    sort: String,
    filters: Option<Filters>,
) -> CmdResult<Page> {
    let server = current_server(&state).await?;
    let filters = filters.unwrap_or_default();
    if filters.min_bitrate_kbps.is_none() {
        return state
            .plex
            .section_filtered(&server, &section, Some((start, size)), &sort, &filters)
            .await
            .map_err(err);
    }

    let key = format!("{}|{section}|{sort}|{}", server.machine_id, serde_json::to_string(&filters).map_err(err)?);
    let cached = filtered.0.lock().unwrap().as_ref().filter(|(k, _)| *k == key).map(|(_, v)| v.clone());
    let all = match cached {
        Some(all) => all,
        None => {
            let page = state
                .plex
                .section_filtered(&server, &section, None, &sort, &filters)
                .await
                .map_err(err)?;
            let all = Arc::new(page.items);
            *filtered.0.lock().unwrap() = Some((key, all.clone()));
            all
        }
    };
    let items = all.iter().skip(start as usize).take(size as usize).cloned().collect();
    Ok(Page { items, total: all.len() as u32 })
}

/// Genres or decades a library can be filtered by.
#[tauri::command]
pub async fn filter_values(state: State<'_, AppState>, section: String, field: String) -> CmdResult<Vec<Directory>> {
    if !matches!(field.as_str(), "genre" | "decade") {
        return Err(format!("unknown filter {field}"));
    }
    let server = current_server(&state).await?;
    state.plex.filter_values(&server, &section, &field).await.map_err(err)
}

#[tauri::command]
pub async fn collections(state: State<'_, AppState>, section: String) -> CmdResult<Vec<Metadata>> {
    let server = current_server(&state).await?;
    state.plex.collections(&server, &section).await.map_err(err)
}

#[tauri::command]
pub async fn collection_items(state: State<'_, AppState>, rating_key: String) -> CmdResult<Vec<Metadata>> {
    let server = current_server(&state).await?;
    state.plex.collection_items(&server, &rating_key).await.map_err(err)
}

#[tauri::command]
pub async fn set_watched(state: State<'_, AppState>, rating_key: String, watched: bool) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.set_watched(&server, &rating_key, watched).await.map_err(err)
}

#[tauri::command]
pub async fn remove_from_continue_watching(state: State<'_, AppState>, rating_key: String) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.remove_from_continue_watching(&server, &rating_key).await.map_err(err)
}

/// The episode a show or season page's Play button starts.
#[tauri::command]
pub async fn up_next(state: State<'_, AppState>, rating_key: String) -> CmdResult<Option<Metadata>> {
    let server = current_server(&state).await?;
    let item = state
        .plex
        .metadata(&server, &rating_key)
        .await
        .map_err(err)?
        .ok_or("That item no longer exists on the server")?;
    state.plex.up_next(&server, &item).await.map_err(err)
}

#[tauri::command]
pub async fn trailers(state: State<'_, AppState>, rating_key: String) -> CmdResult<Vec<Metadata>> {
    let server = current_server(&state).await?;
    state.plex.trailers(&server, &rating_key).await.map_err(err)
}

#[tauri::command]
pub async fn metadata(state: State<'_, AppState>, rating_key: String) -> CmdResult<Metadata> {
    let server = current_server(&state).await?;
    state
        .plex
        .metadata(&server, &rating_key)
        .await
        .map_err(err)?
        .ok_or_else(|| "That item no longer exists on the server".to_owned())
}

#[tauri::command]
pub async fn children(state: State<'_, AppState>, rating_key: String) -> CmdResult<Vec<Metadata>> {
    let server = current_server(&state).await?;
    state.plex.children(&server, &rating_key).await.map_err(err)
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String) -> CmdResult<Vec<Hub>> {
    let server = current_server(&state).await?;
    state.plex.search(&server, &query).await.map_err(err)
}

#[tauri::command]
pub async fn get_prefs(state: State<'_, AppState>) -> CmdResult<Prefs> {
    Ok(state.settings.lock().await.prefs.clone())
}

#[tauri::command]
pub async fn set_prefs(state: State<'_, AppState>, prefs: Prefs) -> CmdResult<()> {
    let mut s = state.settings.lock().await;
    s.prefs = prefs;
    s.save(&state.settings_path).map_err(err)
}
