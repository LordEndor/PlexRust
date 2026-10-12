use std::collections::BTreeMap;
use std::path::PathBuf;

use plex::{ServerConnection, User};
use serde::{Deserialize, Serialize};

/// Everything persisted between launches, stored as JSON in the app's config
/// directory.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub client_id: String,
    pub token: Option<String>,
    pub user: Option<User>,
    pub server: Option<ServerConnection>,
    pub prefs: Prefs,
    /// Audio and subtitle picks per show (or movie), keyed by rating key.
    pub tracks: BTreeMap<String, TrackChoice>,
    /// The Seerr (or Overseerr/Jellyseerr) server used for requests.
    pub seerr: SeerrSettings,
    /// Radarr and Sonarr, read for the upcoming-releases calendar.
    pub radarr: ArrSettings,
    pub sonarr: ArrSettings,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArrSettings {
    /// Empty when this server isn't set up.
    pub url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SeerrSettings {
    /// Empty when requests aren't set up.
    pub url: String,
    /// Only used when signing in with the Plex account doesn't work.
    pub api_key: String,
}

/// The tracks someone picked, described so they can be found again in
/// another episode: by language, and by title when the file names them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackChoice {
    pub audio_language: Option<String>,
    pub audio_title: Option<String>,
    pub subtitles_off: bool,
    pub subtitle_language: Option<String>,
    pub subtitle_title: Option<String>,
    pub subtitle_forced: bool,
}

/// Choices made on the settings page.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// "auto", "button" or "off".
    pub skip_intro: String,
    /// "auto", "button" or "off". Ending credits lead to the next episode.
    pub skip_credits: String,
    /// "auto", "button" or "off". Found from chapter names such as "Recap".
    pub skip_recap: String,
    /// "auto", "button" or "off". Found from chapter names such as "Outro" or "ED".
    pub skip_outro: String,
    /// A quality label from the player's list; "Original" plays the file.
    pub quality: String,
    /// mpv language list such as "sv,swe"; empty keeps the file's default.
    pub audio_language: String,
    /// As above, or "off" to start with subtitles off.
    pub subtitle_language: String,
    /// Accent color name, such as "amber".
    pub accent: String,
    /// "small", "medium" or "large".
    pub poster_size: String,
    /// The rotating banner at the top of Home.
    pub show_featured: bool,
    /// Home rows by hub identifier, in the picked order.
    pub hub_order: Vec<String>,
    /// Home rows turned off, by hub identifier.
    pub hidden_hubs: Vec<String>,
    /// The last sort picked in each library, such as `addedAt:desc`, by section key.
    pub library_sorts: BTreeMap<String, String>,
    /// Home rows made on the settings page, such as "Highest rated movies".
    pub custom_rows: Vec<CustomRow>,
}

/// A Home row listing one library in a picked order, optionally narrowed down.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomRow {
    pub id: String,
    pub title: String,
    /// Library section key.
    pub section: String,
    /// Plex sort such as `audienceRating:desc`.
    pub sort: String,
    pub filters: plex::Filters,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            skip_intro: "auto".into(),
            skip_credits: "auto".into(),
            skip_recap: "auto".into(),
            skip_outro: "auto".into(),
            quality: "Original".into(),
            audio_language: String::new(),
            subtitle_language: String::new(),
            accent: "amber".into(),
            poster_size: "medium".into(),
            show_featured: true,
            hub_order: Vec::new(),
            hidden_hubs: Vec::new(),
            library_sorts: BTreeMap::new(),
            custom_rows: Vec::new(),
        }
    }
}

impl Settings {
    pub fn load(path: &PathBuf) -> Self {
        let mut s: Settings = std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        if s.client_id.is_empty() {
            s.client_id = uuid::Uuid::new_v4().to_string();
        }
        s
    }

    pub fn save(&self, path: &PathBuf) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, path)
    }
}
