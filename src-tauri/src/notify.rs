//! What's new since the app last looked, for "new episode" notifications,
//! and the Discord "Watching" status.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::mpsc::{Sender, channel};

use discord_rich_presence::activity::{Activity, ActivityType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use plex::Metadata;
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::commands::{CmdResult, current_server, err};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Arrivals {
    /// New episodes of shows with at least one episode watched.
    episodes: Vec<Metadata>,
    /// New movies; the app keeps the ones on the watchlist.
    movies: Vec<Metadata>,
}

/// Episodes and movies added after `since` (Unix seconds).
#[tauri::command]
pub async fn new_arrivals(state: State<'_, AppState>, since: i64) -> CmdResult<Arrivals> {
    let server = current_server(&state).await?;
    let sections = state.plex.library_sections(&server).await.map_err(err)?;
    let (mut episodes, mut movies) = (Vec::new(), Vec::new());
    for s in &sections {
        match s.kind.as_str() {
            "show" => episodes.extend(state.plex.added_since(&server, &s.key, 4, since).await.unwrap_or_default()),
            "movie" => movies.extend(state.plex.added_since(&server, &s.key, 1, since).await.unwrap_or_default()),
            _ => {}
        }
    }
    // Only shows being watched: one look per show.
    let mut watching: HashMap<String, bool> = HashMap::new();
    for ep in &episodes {
        let Some(show) = &ep.grandparent_rating_key else { continue };
        if !watching.contains_key(show) {
            let seen = match state.plex.metadata(&server, show).await {
                Ok(Some(m)) => m.viewed_leaf_count.unwrap_or_default() > 0,
                _ => false,
            };
            watching.insert(show.clone(), seen);
        }
    }
    episodes.retain(|e| e.grandparent_rating_key.as_ref().is_some_and(|s| watching.get(s) == Some(&true)));
    Ok(Arrivals { episodes, movies })
}

enum Presence {
    Set { app_id: String, details: String, state: String, start: Option<i64>, end: Option<i64> },
    Clear,
}

/// Talks to the Discord app on its own thread; Discord's pipe is blocking.
pub struct DiscordState {
    tx: Mutex<Sender<Presence>>,
}

impl Default for DiscordState {
    fn default() -> Self {
        let (tx, rx) = channel::<Presence>();
        std::thread::spawn(move || {
            let mut client: Option<(String, DiscordIpcClient)> = None;
            for msg in rx {
                match msg {
                    Presence::Clear => {
                        if let Some((_, c)) = client.as_mut() {
                            let _ = c.clear_activity();
                        }
                    }
                    Presence::Set { app_id, details, state, start, end } => {
                        // A new application id, or no Discord yet: connect (again).
                        if client.as_ref().is_none_or(|(id, _)| *id != app_id) {
                            if let Some((_, mut old)) = client.take() {
                                let _ = old.close();
                            }
                            let Ok(mut c) = DiscordIpcClient::new(&app_id) else { continue };
                            if c.connect().is_err() {
                                continue;
                            }
                            client = Some((app_id.clone(), c));
                        }
                        let Some((_, c)) = client.as_mut() else { continue };
                        let mut activity = Activity::new().activity_type(ActivityType::Watching).details(&details);
                        // Discord turns away lines shorter than two characters.
                        if state.chars().count() >= 2 {
                            activity = activity.state(&state);
                        }
                        if let (Some(start), Some(end)) = (start, end) {
                            activity = activity.timestamps(Timestamps::new().start(start).end(end));
                        }
                        if c.set_activity(activity).is_err() {
                            // Discord was closed; try again from scratch next time.
                            client = None;
                        }
                    }
                }
            }
        });
        Self { tx: Mutex::new(tx) }
    }
}

/// Shows what's playing as a Discord status. `position_ms` and
/// `duration_ms` give the time left; leave them out while paused.
#[tauri::command]
pub fn discord_presence(
    discord: State<'_, DiscordState>,
    app_id: String,
    details: String,
    state: String,
    position_ms: Option<u64>,
    duration_ms: Option<u64>,
) -> CmdResult<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default();
    let (start, end) = match (position_ms, duration_ms) {
        (Some(p), Some(d)) if d > 0 => {
            let start = now - p as i64;
            (Some(start / 1000), Some((start + d as i64) / 1000))
        }
        _ => (None, None),
    };
    let msg = Presence::Set { app_id: app_id.trim().to_owned(), details, state, start, end };
    discord.tx.lock().map_err(err)?.send(msg).map_err(err)
}

#[tauri::command]
pub fn discord_clear(discord: State<'_, DiscordState>) -> CmdResult<()> {
    discord.tx.lock().map_err(err)?.send(Presence::Clear).map_err(err)
}
