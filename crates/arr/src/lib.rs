//! Async client for the calendars of Radarr and Sonarr. Both speak the same
//! `/api/v3` API with an `X-Api-Key` header, so one client covers them.
//!
//! The calendar is turned into one flat list of [`Release`]s: an entry per
//! episode airing, and one per movie release date (in cinemas, digital,
//! physical) that falls inside the asked range.

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("couldn't reach {0}: {1}")]
    Http(Kind, reqwest::Error),
    #[error("{0} didn't accept the API key. Copy it from {0} under Settings, General.")]
    BadKey(Kind),
    #[error("{kind} rejected the request ({status}): {message}")]
    Status { kind: Kind, status: StatusCode, message: String },
    #[error("that address is {found}, not {expected}")]
    WrongApp { expected: Kind, found: String },
    #[error("\"{0}\" isn't a valid address")]
    BadUrl(String),
    #[error("{0} sent something unexpected: {1}")]
    Json(Kind, serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Radarr,
    Sonarr,
}

impl std::fmt::Display for Kind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Kind::Radarr => "Radarr",
            Kind::Sonarr => "Sonarr",
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub app_name: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseKind {
    Movie,
    Episode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MovieRelease {
    Cinema,
    Digital,
    Physical,
}

/// One thing coming out on one day.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    /// Unique across both servers and release types.
    pub id: String,
    pub kind: ReleaseKind,
    /// The movie's or the show's title.
    pub title: String,
    pub year: Option<u32>,
    /// `YYYY-MM-DD`. For episodes this is the air date where the show airs;
    /// `air_date_utc` gives the exact time.
    pub date: String,
    pub air_date_utc: Option<String>,
    pub movie_release: Option<MovieRelease>,
    pub season_number: Option<u32>,
    pub episode_number: Option<u32>,
    pub episode_title: Option<String>,
    /// Already downloaded.
    pub has_file: bool,
    pub monitored: bool,
    pub overview: Option<String>,
    pub runtime: Option<u32>,
    /// Network for shows, studio for movies.
    pub network: Option<String>,
    pub poster: Option<String>,
    pub fanart: Option<String>,
    pub tmdb_id: Option<u64>,
    pub tvdb_id: Option<u64>,
}

pub struct ArrClient {
    http: reqwest::Client,
    kind: Kind,
    /// Ends in `/api/v3`.
    api: String,
    api_key: String,
}

impl ArrClient {
    pub fn new(kind: Kind, url: &str, api_key: &str) -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| Error::Http(kind, e))?;
        Ok(Self {
            http,
            kind,
            api: format!("{}/api/v3", normalize_url(url)?),
            api_key: api_key.trim().to_owned(),
        })
    }

    /// Checks the address answers, the key works and it's the right app.
    pub async fn status(&self) -> Result<Status> {
        let v = self.get("/system/status", &[]).await?;
        let status = Status {
            app_name: v["appName"].as_str().unwrap_or_default().to_owned(),
            version: v["version"].as_str().unwrap_or_default().to_owned(),
        };
        let other = match self.kind {
            Kind::Radarr => "sonarr",
            Kind::Sonarr => "radarr",
        };
        if status.app_name.eq_ignore_ascii_case(other) {
            return Err(Error::WrongApp { expected: self.kind, found: status.app_name });
        }
        Ok(status)
    }

    /// Releases between `start` and `end` (`YYYY-MM-DD`, both included).
    pub async fn calendar(&self, start: &str, end: &str) -> Result<Vec<Release>> {
        let mut query = vec![("start", start.to_owned()), ("end", end.to_owned()), ("unmonitored", "false".to_owned())];
        if self.kind == Kind::Sonarr {
            query.push(("includeSeries", "true".to_owned()));
        }
        let v = self.get("/calendar", &query).await?;
        let items: Vec<Value> = serde_json::from_value(v).map_err(|e| Error::Json(self.kind, e))?;
        Ok(match self.kind {
            Kind::Radarr => items.iter().flat_map(|m| movie_releases(m, start, end)).collect(),
            Kind::Sonarr => items.iter().filter_map(episode_release).collect(),
        })
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        let resp = self
            .http
            .get(format!("{}{path}", self.api))
            .header("X-Api-Key", &self.api_key)
            .header("Accept", "application/json")
            .query(query)
            .send()
            .await
            .map_err(|e| Error::Http(self.kind, e))?;
        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(Error::BadKey(self.kind));
        }
        let text = resp.text().await.map_err(|e| Error::Http(self.kind, e))?;
        if !status.is_success() {
            let message = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["message"].as_str().map(str::to_owned))
                .unwrap_or_else(|| text.chars().take(200).collect());
            return Err(Error::Status { kind: self.kind, status, message });
        }
        serde_json::from_str(&text).map_err(|e| Error::Json(self.kind, e))
    }
}

fn movie_releases(m: &Value, start: &str, end: &str) -> Vec<Release> {
    let id = m["id"].as_u64().unwrap_or_default();
    [
        ("inCinemas", MovieRelease::Cinema, "cinema"),
        ("digitalRelease", MovieRelease::Digital, "digital"),
        ("physicalRelease", MovieRelease::Physical, "physical"),
    ]
    .into_iter()
    .filter_map(|(field, kind, slug)| {
        let date = day(m[field].as_str()?)?;
        (date >= start && date <= end).then(|| Release {
            id: format!("radarr-{id}-{slug}"),
            kind: ReleaseKind::Movie,
            title: string(&m["title"]).unwrap_or_default(),
            year: m["year"].as_u64().map(|y| y as u32).filter(|y| *y > 0),
            date: date.to_owned(),
            air_date_utc: None,
            movie_release: Some(kind),
            season_number: None,
            episode_number: None,
            episode_title: None,
            has_file: m["hasFile"].as_bool().unwrap_or(false),
            monitored: m["monitored"].as_bool().unwrap_or(true),
            overview: string(&m["overview"]),
            runtime: m["runtime"].as_u64().map(|r| r as u32).filter(|r| *r > 0),
            network: string(&m["studio"]),
            poster: image(&m["images"], "poster"),
            fanart: image(&m["images"], "fanart"),
            tmdb_id: m["tmdbId"].as_u64(),
            tvdb_id: None,
        })
    })
    .collect()
}

fn episode_release(e: &Value) -> Option<Release> {
    let series = &e["series"];
    let air_date_utc = string(&e["airDateUtc"]);
    let date = string(&e["airDate"]).or_else(|| air_date_utc.as_deref().and_then(day).map(str::to_owned))?;
    Some(Release {
        id: format!("sonarr-{}", e["id"].as_u64().unwrap_or_default()),
        kind: ReleaseKind::Episode,
        title: string(&series["title"]).unwrap_or_default(),
        year: series["year"].as_u64().map(|y| y as u32).filter(|y| *y > 0),
        date,
        air_date_utc,
        movie_release: None,
        season_number: e["seasonNumber"].as_u64().map(|n| n as u32),
        episode_number: e["episodeNumber"].as_u64().map(|n| n as u32),
        episode_title: string(&e["title"]).filter(|t| t != "TBA"),
        has_file: e["hasFile"].as_bool().unwrap_or(false),
        monitored: e["monitored"].as_bool().unwrap_or(true),
        overview: string(&e["overview"]),
        runtime: [&e["runtime"], &series["runtime"]]
            .into_iter()
            .find_map(|r| r.as_u64().filter(|r| *r > 0))
            .map(|r| r as u32),
        network: string(&series["network"]),
        poster: image(&series["images"], "poster"),
        fanart: image(&series["images"], "fanart"),
        tmdb_id: series["tmdbId"].as_u64().filter(|id| *id > 0),
        tvdb_id: series["tvdbId"].as_u64().filter(|id| *id > 0),
    })
}

fn string(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned)
}

/// `2026-10-20T00:00:00Z` → `2026-10-20`.
fn day(s: &str) -> Option<&str> {
    s.get(..10).filter(|d| d.as_bytes().get(4) == Some(&b'-'))
}

/// The internet address of an image; the local `/MediaCover` copies need
/// the API key, so they aren't used.
fn image(images: &Value, cover_type: &str) -> Option<String> {
    images
        .as_array()?
        .iter()
        .find(|i| i["coverType"] == cover_type)
        .and_then(|i| string(&i["remoteUrl"]))
        .filter(|u| u.starts_with("http"))
}

/// Adds `http://` when missing and drops a trailing `/` or `/api/v3`.
/// A URL base such as `/radarr` is kept.
pub fn normalize_url(input: &str) -> Result<String> {
    let mut url = input.trim().trim_end_matches('/').to_owned();
    if url.is_empty() {
        return Err(Error::BadUrl(input.to_owned()));
    }
    if !url.contains("://") {
        url = format!("http://{url}");
    }
    for suffix in ["/api/v3", "/api"] {
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

    #[test]
    fn normalizes_addresses() {
        assert_eq!(normalize_url("192.168.1.109:7878/").unwrap(), "http://192.168.1.109:7878");
        assert_eq!(normalize_url("https://nas/sonarr/api/v3").unwrap(), "https://nas/sonarr");
        assert!(normalize_url("  ").is_err());
        assert!(normalize_url("ftp://nas").is_err());
    }
}
