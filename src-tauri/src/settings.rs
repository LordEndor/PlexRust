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
    /// A quality label from the player's list; "Original" plays the file.
    pub quality: String,
    /// mpv language list such as "sv,swe"; empty keeps the file's default.
    pub audio_language: String,
    /// As above, or "off" to start with subtitles off.
    pub subtitle_language: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            skip_intro: "auto".into(),
            skip_credits: "auto".into(),
            quality: "Original".into(),
            audio_language: String::new(),
            subtitle_language: String::new(),
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
