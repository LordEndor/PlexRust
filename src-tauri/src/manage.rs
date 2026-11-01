//! Server housekeeping from the item and library pages. Needs the server
//! owner's (or an admin's) account; Plex turns anyone else away.

use plex::{Artwork, MatchResult};
use tauri::State;

use crate::AppState;
use crate::commands::{CmdResult, current_server, err};

#[tauri::command]
pub async fn scan_library(state: State<'_, AppState>, section: String, force: bool) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.scan_section(&server, &section, force).await.map_err(err)
}

#[tauri::command]
pub async fn refresh_item(state: State<'_, AppState>, rating_key: String) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.refresh_item(&server, &rating_key).await.map_err(err)
}

#[tauri::command]
pub async fn analyze_item(state: State<'_, AppState>, rating_key: String) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.analyze_item(&server, &rating_key).await.map_err(err)
}

#[tauri::command]
pub async fn delete_item(state: State<'_, AppState>, rating_key: String) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.delete_item(&server, &rating_key).await.map_err(|e| {
        let msg = err(e);
        if msg.contains("(403") || msg.contains("(401") {
            "Plex didn't allow deleting it. Turn on Settings → Library → \"Allow media deletion\" on the server.".to_owned()
        } else {
            msg
        }
    })
}

#[tauri::command]
pub async fn find_matches(
    state: State<'_, AppState>,
    rating_key: String,
    title: String,
    year: Option<i32>,
) -> CmdResult<Vec<MatchResult>> {
    let server = current_server(&state).await?;
    state.plex.matches(&server, &rating_key, &title, year).await.map_err(err)
}

#[tauri::command]
pub async fn apply_match(state: State<'_, AppState>, rating_key: String, result: MatchResult) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.apply_match(&server, &rating_key, &result).await.map_err(err)
}

/// `fields` maps Plex field names (`title`, `titleSort`, `originalTitle`,
/// `summary`, `year`, ...) to their new values.
#[tauri::command]
pub async fn edit_item(
    state: State<'_, AppState>,
    section: u64,
    rating_key: String,
    kind: String,
    fields: Vec<(String, String)>,
) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.edit_item(&server, section, &rating_key, &kind, &fields).await.map_err(err)
}

#[tauri::command]
pub async fn item_posters(state: State<'_, AppState>, rating_key: String) -> CmdResult<Vec<Artwork>> {
    let server = current_server(&state).await?;
    state.plex.posters(&server, &rating_key).await.map_err(err)
}

#[tauri::command]
pub async fn set_poster(state: State<'_, AppState>, rating_key: String, poster: String) -> CmdResult<()> {
    let server = current_server(&state).await?;
    state.plex.set_poster(&server, &rating_key, &poster).await.map_err(err)
}
