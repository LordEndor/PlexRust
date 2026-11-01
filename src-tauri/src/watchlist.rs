//! The Plex watchlist, matched up with what's already on the server.

use plex::Metadata;
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::commands::{CmdResult, account_token, current_server, err};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistItem {
    /// The title as Plex's Discover service describes it.
    item: Metadata,
    /// The same title on this server, when it's there to play.
    local: Option<Metadata>,
    /// For requesting it through Seerr when it isn't.
    tmdb_id: Option<u64>,
}

fn tmdb_id(m: &Metadata) -> Option<u64> {
    m.guids.iter().find_map(|g| g.id.strip_prefix("tmdb://")?.parse().ok())
}

/// The account's watchlist, newest first, each title paired with the copy on
/// this server if there is one.
#[tauri::command]
pub async fn watchlist(state: State<'_, AppState>) -> CmdResult<Vec<WatchlistItem>> {
    let token = account_token(&state).await?;
    let server = current_server(&state).await?;
    let items = state.plex.watchlist(&token).await.map_err(err)?;
    // Look every title up on the server at once; a failed lookup just means
    // it shows as not in the library.
    let lookups: Vec<_> = items
        .iter()
        .map(|m| {
            let (plex, server, guid) = (state.plex.clone(), server.clone(), m.guid.clone());
            tauri::async_runtime::spawn(async move {
                match guid {
                    Some(g) => plex.find_by_guid(&server, &g).await.ok().flatten(),
                    None => None,
                }
            })
        })
        .collect();
    let mut out = Vec::with_capacity(items.len());
    for (item, lookup) in items.into_iter().zip(lookups) {
        let local = lookup.await.ok().flatten();
        out.push(WatchlistItem { tmdb_id: tmdb_id(&item), item, local });
    }
    Ok(out)
}

/// Adds a title (by its `plex://` guid) to the watchlist, or takes it off.
#[tauri::command]
pub async fn watchlist_set(state: State<'_, AppState>, guid: String, on: bool) -> CmdResult<()> {
    let token = account_token(&state).await?;
    state.plex.set_watchlisted(&token, &guid, on).await.map_err(err)
}

#[tauri::command]
pub async fn watchlist_has(state: State<'_, AppState>, guid: String) -> CmdResult<bool> {
    let token = account_token(&state).await?;
    state.plex.is_watchlisted(&token, &guid).await.map_err(err)
}
