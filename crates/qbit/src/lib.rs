//! Async client for qBittorrent's Web API (`/api/v2`), the same API its Web
//! UI uses.
//!
//! Signing in gives a session cookie (`SID`, or `QBT_SID_<port>` since
//! qBittorrent 5.1) that the client keeps and sends along;
//! when qBittorrent forgets it (a restart, a timeout) the next call signs in
//! again once. qBittorrent can also skip the password for some networks, so
//! an empty username means "don't sign in".
//!
//! The list of torrents comes from `/sync/maindata`, which after the first
//! call only sends what changed. [`Sync`] keeps the full picture.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::StatusCode;
use reqwest::header::{CONTENT_TYPE, COOKIE, REFERER, SET_COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("couldn't reach qBittorrent: {0}")]
    Http(reqwest::Error),
    #[error(
        "qBittorrent didn't accept the username or password. Check them in qBittorrent under Tools, Options, Web UI. A new install has no admin/adminadmin login: it prints a temporary password in its log."
    )]
    BadLogin,
    #[error(
        "qBittorrent asks for a username and password. Enter the ones for its Web UI (Tools, Options, Web UI)."
    )]
    NeedsLogin,
    #[error(
        "qBittorrent accepted the login but then refused the session. Check that the address is qBittorrent's own Web UI and not a proxy that drops cookies."
    )]
    SessionRefused,
    #[error(
        "qBittorrent has blocked this computer after too many wrong passwords. Wait a while, or restart qBittorrent."
    )]
    Banned,
    #[error("qBittorrent rejected the request ({status}): {message}")]
    Status { status: StatusCode, message: String },
    #[error("\"{0}\" isn't a valid address")]
    BadUrl(String),
    #[error("that address answers, but it isn't qBittorrent's Web UI")]
    NotQbit,
    #[error("qBittorrent sent something unexpected: {0}")]
    Json(serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    /// Such as `v5.0.2`.
    pub app: String,
    /// Such as `2.11.2`.
    pub api: String,
}

/// The torrent states the app tells apart. qBittorrent has more; they're
/// folded into these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Downloading,
    /// Downloading but nothing is coming in.
    Stalled,
    /// Waiting its turn, or checking files.
    Queued,
    Checking,
    /// Finished and still sharing.
    Seeding,
    /// Finished and stopped.
    Completed,
    Paused,
    Error,
}

impl State {
    fn from_qbit(s: &str) -> Self {
        match s {
            "downloading" | "forcedDL" | "metaDL" | "forcedMetaDL" => State::Downloading,
            "stalledDL" => State::Stalled,
            "queuedDL" | "queuedUP" | "allocating" | "moving" => State::Queued,
            "checkingDL" | "checkingUP" | "checkingResumeData" => State::Checking,
            "uploading" | "forcedUP" | "stalledUP" => State::Seeding,
            "pausedUP" | "stoppedUP" => State::Completed,
            "pausedDL" | "stoppedDL" => State::Paused,
            "error" | "missingFiles" => State::Error,
            _ => State::Queued,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Torrent {
    /// Lowercase info hash; Radarr and Sonarr know downloads by it.
    pub hash: String,
    pub name: String,
    pub state: State,
    /// qBittorrent's own state name, such as `stalledDL`.
    pub raw_state: String,
    /// 0 to 1.
    pub progress: f64,
    /// Bytes picked for download.
    pub size: u64,
    pub downloaded: u64,
    /// Bytes per second.
    pub dl_speed: u64,
    pub up_speed: u64,
    /// Seconds left, when qBittorrent can tell.
    pub eta: Option<u64>,
    pub seeds: u64,
    pub peers: u64,
    pub category: String,
    pub ratio: f64,
    /// Unix seconds.
    pub added_on: u64,
    pub completed_on: Option<u64>,
    pub force_start: bool,
    pub save_path: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub dl_speed: u64,
    pub up_speed: u64,
    /// Bytes free where qBittorrent saves.
    pub free_space: Option<u64>,
    /// The alternative ("turtle") speed limits are on.
    pub alt_speed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    /// Newest first.
    pub torrents: Vec<Torrent>,
    pub transfer: Transfer,
    /// Categories by name, also the empty ones.
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Pause,
    Resume,
    ForceStart,
    Recheck,
    Delete,
    DeleteWithFiles,
}

/// The full list as built from `/sync/maindata` replies.
#[derive(Debug, Default)]
pub struct Sync {
    rid: u64,
    torrents: HashMap<String, Map<String, Value>>,
    server_state: Map<String, Value>,
    categories: BTreeMap<String, ()>,
}

impl Sync {
    /// Folds one `/sync/maindata` reply into the list.
    pub fn apply(&mut self, v: &Value) {
        if v["full_update"].as_bool().unwrap_or(false) {
            self.torrents.clear();
            self.server_state.clear();
            self.categories.clear();
        }
        if let Some(rid) = v["rid"].as_u64() {
            self.rid = rid;
        }
        if let Some(changed) = v["torrents"].as_object() {
            for (hash, fields) in changed {
                let entry = self.torrents.entry(hash.to_ascii_lowercase()).or_default();
                if let Some(fields) = fields.as_object() {
                    entry.extend(fields.iter().map(|(k, v)| (k.clone(), v.clone())));
                }
            }
        }
        for hash in v["torrents_removed"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            self.torrents.remove(&hash.to_ascii_lowercase());
        }
        if let Some(state) = v["server_state"].as_object() {
            self.server_state
                .extend(state.iter().map(|(k, v)| (k.clone(), v.clone())));
        }
        if let Some(cats) = v["categories"].as_object() {
            self.categories.extend(cats.keys().map(|k| (k.clone(), ())));
        }
        for name in v["categories_removed"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            self.categories.remove(name);
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut torrents: Vec<Torrent> = self
            .torrents
            .iter()
            .map(|(hash, t)| torrent(hash, t))
            .collect();
        torrents.sort_by(|a, b| {
            b.added_on
                .cmp(&a.added_on)
                .then_with(|| a.name.cmp(&b.name))
        });
        let s = &self.server_state;
        Snapshot {
            transfer: Transfer {
                dl_speed: num(s.get("dl_info_speed")),
                up_speed: num(s.get("up_info_speed")),
                free_space: s.get("free_space_on_disk").and_then(Value::as_u64),
                alt_speed: s
                    .get("use_alt_speed_limits")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            },
            categories: self.categories.keys().cloned().collect(),
            torrents,
        }
    }
}

fn num(v: Option<&Value>) -> u64 {
    v.and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f.max(0.0) as u64)))
        .unwrap_or(0)
}

fn torrent(hash: &str, t: &Map<String, Value>) -> Torrent {
    let raw_state = t
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    // qBittorrent says 8640000 (100 days) when it can't tell.
    let eta = t
        .get("eta")
        .and_then(Value::as_u64)
        .filter(|e| *e < 8_640_000);
    let completed_on = t
        .get("completion_on")
        .and_then(Value::as_i64)
        .filter(|c| *c > 0)
        .map(|c| c as u64);
    let size = match num(t.get("size")) {
        0 => num(t.get("total_size")),
        n => n,
    };
    Torrent {
        hash: hash.to_owned(),
        name: t
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        state: State::from_qbit(&raw_state),
        raw_state,
        progress: t
            .get("progress")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .clamp(0.0, 1.0),
        size,
        downloaded: num(t.get("completed")),
        dl_speed: num(t.get("dlspeed")),
        up_speed: num(t.get("upspeed")),
        eta,
        seeds: num(t.get("num_seeds")),
        peers: num(t.get("num_leechs")),
        category: t
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        ratio: t
            .get("ratio")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0),
        added_on: num(t.get("added_on")),
        completed_on,
        force_start: t
            .get("force_start")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        save_path: t
            .get("save_path")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    }
}

pub struct QbitClient {
    http: reqwest::Client,
    /// Ends in `/api/v2`.
    api: String,
    /// Sent as `Referer`, which qBittorrent checks against its own address.
    origin: String,
    username: String,
    password: String,
    /// The session cookie as sent back, such as `SID=abc`.
    sid: Mutex<Option<String>>,
    /// qBittorrent 5 renamed pause and resume to stop and start.
    new_names: Mutex<Option<bool>>,
}

impl QbitClient {
    pub fn new(url: &str, username: &str, password: &str) -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(Error::Http)?;
        let base = normalize_url(url)?;
        Ok(Self {
            http,
            api: format!("{base}/api/v2"),
            origin: format!("{base}/"),
            username: username.trim().to_owned(),
            password: password.to_owned(),
            sid: Mutex::new(None),
            new_names: Mutex::new(None),
        })
    }

    /// Signs in (when a username is set) and reads the version, to check
    /// the address and the password.
    pub async fn version(&self) -> Result<Version> {
        let app = self.call("GET", "/app/version", &[]).await?;
        let api = self.call("GET", "/app/webapiVersion", &[]).await?;
        let (app, api) = (app.trim().to_owned(), api.trim().to_owned());
        if !app.starts_with('v') && !app.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return Err(Error::NotQbit);
        }
        *self.new_names.lock().unwrap() = Some(api_at_least(&api, 2, 11));
        Ok(Version { app, api })
    }

    /// Changes since `sync`'s last call, folded into it.
    pub async fn sync(&self, sync: &mut Sync) -> Result<()> {
        let rid = sync.rid.to_string();
        let text = self.call("GET", "/sync/maindata", &[("rid", &rid)]).await?;
        let v: Value = serde_json::from_str(&text).map_err(Error::Json)?;
        if !v.is_object() {
            return Err(Error::NotQbit);
        }
        sync.apply(&v);
        Ok(())
    }

    pub async fn act(&self, action: Action, hashes: &[String]) -> Result<()> {
        if hashes.is_empty() {
            return Ok(());
        }
        let hashes = hashes.join("|");
        let known = *self.new_names.lock().unwrap();
        let new_names = match known {
            Some(n) => n,
            None => api_at_least(&self.version().await?.api, 2, 11),
        };
        let (path, extra): (&str, &[(&str, &str)]) = match action {
            Action::Pause if new_names => ("/torrents/stop", &[]),
            Action::Pause => ("/torrents/pause", &[]),
            Action::Resume if new_names => ("/torrents/start", &[]),
            Action::Resume => ("/torrents/resume", &[]),
            Action::ForceStart => ("/torrents/setForceStart", &[("value", "true")]),
            Action::Recheck => ("/torrents/recheck", &[]),
            Action::Delete => ("/torrents/delete", &[("deleteFiles", "false")]),
            Action::DeleteWithFiles => ("/torrents/delete", &[("deleteFiles", "true")]),
        };
        let mut form = vec![("hashes", hashes.as_str())];
        form.extend_from_slice(extra);
        self.call("POST", path, &form).await.map(|_| ())
    }

    /// Turns the alternative ("turtle") speed limits on or off.
    pub async fn toggle_alt_speed(&self) -> Result<()> {
        self.call("POST", "/transfer/toggleSpeedLimitsMode", &[])
            .await
            .map(|_| ())
    }

    /// One call, signing in first if there's no session yet, and once more
    /// if qBittorrent has forgotten it.
    async fn call(&self, method: &str, path: &str, params: &[(&str, &str)]) -> Result<String> {
        if !self.username.is_empty() && self.sid.lock().unwrap().is_none() {
            self.login().await?;
        }
        match self.send(method, path, params).await {
            Err(Error::NeedsLogin) if !self.username.is_empty() => {
                self.login().await?;
                match self.send(method, path, params).await {
                    Err(Error::NeedsLogin) => Err(Error::SessionRefused),
                    other => other,
                }
            }
            other => other,
        }
    }

    async fn send(&self, method: &str, path: &str, params: &[(&str, &str)]) -> Result<String> {
        let url = format!("{}{path}", self.api);
        let mut req = if method == "POST" {
            self.http
                .post(url)
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(encode(params))
        } else {
            self.http.get(url).query(params)
        };
        req = req.header(REFERER, &self.origin);
        if let Some(sid) = self.sid.lock().unwrap().clone() {
            req = req.header(COOKIE, sid);
        }
        let resp = req.send().await.map_err(Error::Http)?;
        let status = resp.status();
        let text = resp.text().await.map_err(Error::Http)?;
        match status {
            s if s.is_success() => Ok(text),
            StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED => {
                *self.sid.lock().unwrap() = None;
                Err(Error::NeedsLogin)
            }
            StatusCode::NOT_FOUND => Err(Error::NotQbit),
            status => Err(Error::Status {
                status,
                message: text.chars().take(200).collect(),
            }),
        }
    }

    async fn login(&self) -> Result<()> {
        let resp = self
            .http
            .post(format!("{}/auth/login", self.api))
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(REFERER, &self.origin)
            .body(encode(&[
                ("username", &self.username),
                ("password", &self.password),
            ]))
            .send()
            .await
            .map_err(Error::Http)?;
        let status = resp.status();
        let sid = resp
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(|c| c.split(';').next())
            .find(|pair| {
                let name = pair.split('=').next().unwrap_or_default();
                name == "SID" || name.starts_with("QBT_SID")
            })
            .map(str::to_owned);
        let text = resp.text().await.map_err(Error::Http)?;
        match status {
            StatusCode::FORBIDDEN => Err(Error::Banned),
            // qBittorrent 5.2 answers a wrong username or password with 401
            // instead of "Fails.".
            StatusCode::UNAUTHORIZED => Err(Error::BadLogin),
            StatusCode::NOT_FOUND => Err(Error::NotQbit),
            s if s.is_success() => match sid {
                Some(sid) if !sid.ends_with('=') => {
                    *self.sid.lock().unwrap() = Some(sid);
                    Ok(())
                }
                // "Fails." with no cookie: wrong username or password.
                _ if text.trim().starts_with("Fails") => Err(Error::BadLogin),
                // "Ok." with no new cookie: this network skips the password.
                _ => Ok(()),
            },
            status => Err(Error::Status {
                status,
                message: text.chars().take(200).collect(),
            }),
        }
    }
}

/// `2.11.2` is at least 2.11.
fn api_at_least(version: &str, major: u64, minor: u64) -> bool {
    let mut parts = version.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    let (a, b) = (parts.next().unwrap_or(0), parts.next().unwrap_or(0));
    (a, b) >= (major, minor)
}

/// `application/x-www-form-urlencoded`.
fn encode(params: &[(&str, &str)]) -> String {
    fn escape(s: &str) -> String {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'*' => {
                    (b as char).to_string()
                }
                b' ' => "+".to_owned(),
                b => format!("%{b:02X}"),
            })
            .collect()
    }
    params
        .iter()
        .map(|(k, v)| format!("{}={}", escape(k), escape(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Adds `http://` when missing and drops a trailing `/` or `/api/v2`.
/// A URL base such as `/qbittorrent` is kept.
pub fn normalize_url(input: &str) -> Result<String> {
    let mut url = input.trim().trim_end_matches('/').to_owned();
    if url.is_empty() {
        return Err(Error::BadUrl(input.to_owned()));
    }
    if !url.contains("://") {
        url = format!("http://{url}");
    }
    for suffix in ["/api/v2", "/api"] {
        if let Some(stripped) = url.strip_suffix(suffix) {
            url = stripped.to_owned();
        }
    }
    let parsed = reqwest::Url::parse(&url).map_err(|_| Error::BadUrl(input.to_owned()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(Error::BadUrl(input.to_owned()));
    }
    Ok(url.trim_end_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_addresses() {
        assert_eq!(
            normalize_url("192.168.1.109:8888/").unwrap(),
            "http://192.168.1.109:8888"
        );
        assert_eq!(
            normalize_url("https://nas/qbit/api/v2").unwrap(),
            "https://nas/qbit"
        );
        assert!(normalize_url("").is_err());
    }

    #[test]
    fn encodes_forms() {
        assert_eq!(
            encode(&[("username", "al bin"), ("password", "p&ss=1é")]),
            "username=al+bin&password=p%26ss%3D1%C3%A9"
        );
    }

    #[test]
    fn compares_api_versions() {
        assert!(api_at_least("2.11.2", 2, 11));
        assert!(api_at_least("3.0", 2, 11));
        assert!(!api_at_least("2.8.19", 2, 11));
    }

    #[test]
    fn folds_partial_updates() {
        let mut sync = Sync::default();
        sync.apply(&json!({
            "rid": 1, "full_update": true,
            "torrents": {
                "AAA": {"name": "Severance.S02E05.1080p", "state": "downloading", "progress": 0.5, "size": 2000, "completed": 1000,
                        "dlspeed": 500, "eta": 2, "category": "tv-sonarr", "added_on": 20},
                "bbb": {"name": "Dune.Part.Three.2160p", "state": "stalledUP", "progress": 1.0, "size": 9000, "eta": 8640000,
                        "category": "radarr", "added_on": 10, "completion_on": 15}
            },
            "categories": {"radarr": {}, "tv-sonarr": {}},
            "server_state": {"dl_info_speed": 500, "up_info_speed": 20, "free_space_on_disk": 123, "use_alt_speed_limits": false}
        }));
        sync.apply(&json!({
            "rid": 2,
            "torrents": {"aaa": {"progress": 0.75, "state": "pausedDL", "dlspeed": 0}},
            "torrents_removed": ["BBB"],
            "server_state": {"use_alt_speed_limits": true}
        }));
        assert_eq!(sync.rid, 2);
        let snap = sync.snapshot();
        assert_eq!(snap.torrents.len(), 1);
        let t = &snap.torrents[0];
        assert_eq!(t.hash, "aaa");
        assert_eq!(t.name, "Severance.S02E05.1080p");
        assert_eq!(t.state, State::Paused);
        assert_eq!(t.progress, 0.75);
        assert_eq!(t.eta, Some(2));
        assert!(snap.transfer.alt_speed);
        assert_eq!(snap.transfer.free_space, Some(123));
        assert_eq!(snap.categories, ["radarr", "tv-sonarr"]);
    }

    #[test]
    fn unknown_eta_is_none() {
        let t = torrent(
            "x",
            json!({"eta": 8640000, "state": "uploading"})
                .as_object()
                .unwrap(),
        );
        assert_eq!(t.eta, None);
        assert_eq!(t.state, State::Seeding);
    }
}
