//! Async client for a Seerr request server. Overseerr and Jellyseerr share
//! its `/api/v1` API, so the same client works with all three.
//!
//! Responses for browsing (search, discover, details, quota) are passed
//! through as JSON: the app only reads a few fields, and taking the rest as
//! it comes keeps older Overseerr installs working.

use futures::future::join_all;
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("couldn't reach Seerr: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Seerr rejected the request ({status}): {message}")]
    Status { status: StatusCode, message: String },
    #[error("Seerr didn't accept your Plex account. Check that Plex sign-in is enabled in Seerr and that your account has been imported, or use an API key.")]
    PlexSignIn,
    #[error("\"{0}\" isn't a valid Seerr address")]
    BadUrl(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// How the app signs in to Seerr.
#[derive(Debug, Clone)]
pub enum Auth {
    /// Sign in as the Plex account the app already uses. Requests are made
    /// as that Seerr user, with its own permissions and quota.
    Plex(String),
    /// Seerr's API key from Settings > General. Acts as the admin.
    ApiKey(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Movie,
    Tv,
}

impl MediaType {
    fn as_str(self) -> &'static str {
        match self {
            MediaType::Movie => "movie",
            MediaType::Tv => "tv",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: u64,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub plex_username: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub permissions: u64,
}

impl User {
    pub fn name(&self) -> String {
        [&self.display_name, &self.username, &self.plex_username, &self.email]
            .into_iter()
            .flatten()
            .find(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| format!("User {}", self.id))
    }
}

/// What the settings page and the request buttons need to know.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub version: String,
    pub user: User,
    pub user_name: String,
    /// A 4K Radarr is set up, so movies can be requested in 4K.
    pub movie_4k: bool,
    /// A 4K Sonarr is set up.
    pub tv_4k: bool,
}

/// A new request. `seasons` is only used for shows; empty means all.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRequest {
    pub media_type: MediaType,
    pub tmdb_id: u64,
    #[serde(default)]
    pub seasons: Vec<u32>,
    #[serde(default)]
    pub is_4k: bool,
}

/// Discover rows the app shows, mapped to their API paths.
pub const DISCOVER_ROWS: &[(&str, &str)] = &[
    ("trending", "/discover/trending"),
    ("movies", "/discover/movies"),
    ("tv", "/discover/tv"),
    ("upcomingMovies", "/discover/movies/upcoming"),
    ("upcomingTv", "/discover/tv/upcoming"),
];

/// How a full category page is narrowed and ordered. Each field is one of
/// the query parameters Seerr's own filter panel sends to `/discover/movies`
/// and `/discover/tv`; unset fields are left out.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Browse {
    /// TMDB's sort, like `popularity.desc` or `vote_average.desc`.
    #[serde(default)]
    pub sort_by: Option<String>,
    /// A TMDB genre id.
    #[serde(default)]
    pub genre: Option<u64>,
    /// Released (or first aired) on or after this day, `YYYY-MM-DD`.
    #[serde(default)]
    pub date_from: Option<String>,
    /// Released (or first aired) on or before this day.
    #[serde(default)]
    pub date_to: Option<String>,
    /// Lowest TMDB user score, 0 to 10.
    #[serde(default)]
    pub min_rating: Option<f32>,
    /// Fewest TMDB votes, so a sort by score isn't topped by titles three
    /// people rated.
    #[serde(default)]
    pub min_votes: Option<u32>,
}

impl Browse {
    fn query(&self, media_type: MediaType, page: u32) -> Vec<(&'static str, String)> {
        let (from, to) = match media_type {
            MediaType::Movie => ("primaryReleaseDateGte", "primaryReleaseDateLte"),
            MediaType::Tv => ("firstAirDateGte", "firstAirDateLte"),
        };
        let mut q = vec![("page", page.to_string())];
        let nonempty = |s: &Option<String>| s.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
        if let Some(v) = nonempty(&self.sort_by) {
            q.push(("sortBy", v));
        }
        if let Some(v) = self.genre {
            q.push(("genre", v.to_string()));
        }
        if let Some(v) = nonempty(&self.date_from) {
            q.push((from, v));
        }
        if let Some(v) = nonempty(&self.date_to) {
            q.push((to, v));
        }
        if let Some(v) = self.min_rating.filter(|v| *v > 0.0) {
            q.push(("voteAverageGte", v.to_string()));
        }
        if let Some(v) = self.min_votes.filter(|v| *v > 0) {
            q.push(("voteCountGte", v.to_string()));
        }
        q
    }
}

pub struct SeerrClient {
    http: reqwest::Client,
    /// Ends in `/api/v1`.
    api: String,
    auth: Auth,
    signed_in: Mutex<bool>,
}

impl SeerrClient {
    pub fn new(url: &str, auth: Auth) -> Result<Self> {
        let http = reqwest::Client::builder()
            .cookie_store(true)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()?;
        Ok(Self {
            http,
            api: format!("{}/api/v1", normalize_url(url)?),
            auth,
            signed_in: Mutex::new(false),
        })
    }

    /// Checks the server answers and who we are signed in as.
    pub async fn info(&self) -> Result<Info> {
        let status = self.get("/status", &[]).await?;
        let user: User = serde_json::from_value(self.get("/auth/me", &[]).await?).map_err(bad_json)?;
        // Listing services needs admin rights; without them, assume no 4K.
        let (radarr, sonarr) = futures::join!(self.get("/service/radarr", &[]), self.get("/service/sonarr", &[]));
        Ok(Info {
            version: status["version"].as_str().unwrap_or_default().to_owned(),
            user_name: user.name(),
            user,
            movie_4k: radarr.map(|v| has_4k(&v)).unwrap_or(false),
            tv_4k: sonarr.map(|v| has_4k(&v)).unwrap_or(false),
        })
    }

    pub async fn search(&self, query: &str, page: u32) -> Result<Value> {
        self.get("/search", &[("query", query.to_owned()), ("page", page.to_string())]).await
    }

    /// One page of a row from [`DISCOVER_ROWS`], by its key.
    pub async fn discover(&self, row: &str, page: u32) -> Result<Value> {
        let path = DISCOVER_ROWS
            .iter()
            .find(|(key, _)| *key == row)
            .map(|(_, path)| *path)
            .ok_or_else(|| Error::Status {
                status: StatusCode::NOT_FOUND,
                message: format!("unknown discover row {row}"),
            })?;
        self.get(path, &[("page", page.to_string())]).await
    }

    /// One page of every movie or show on TMDB, sorted and filtered the way
    /// Seerr's full Movies and Series pages do it.
    pub async fn browse(&self, media_type: MediaType, page: u32, browse: &Browse) -> Result<Value> {
        let path = match media_type {
            MediaType::Movie => "/discover/movies",
            MediaType::Tv => "/discover/tv",
        };
        self.get(path, &browse.query(media_type, page)).await
    }

    /// TMDB's movie or show genres, as `[{ id, name }]`.
    pub async fn genres(&self, media_type: MediaType) -> Result<Value> {
        self.get(&format!("/genres/{}", media_type.as_str()), &[]).await
    }

    /// Movie or show details, including `mediaInfo` with what's available
    /// and requested already.
    pub async fn details(&self, media_type: MediaType, tmdb_id: u64) -> Result<Value> {
        self.get(&format!("/{}/{tmdb_id}", media_type.as_str()), &[]).await
    }

    /// How many requests the user has left, per media type.
    pub async fn quota(&self, user_id: u64) -> Result<Value> {
        self.get(&format!("/user/{user_id}/quota"), &[]).await
    }

    pub async fn request(&self, req: &NewRequest) -> Result<Value> {
        let mut body = serde_json::json!({
            "mediaType": req.media_type.as_str(),
            "mediaId": req.tmdb_id,
            "is4k": req.is_4k,
        });
        if req.media_type == MediaType::Tv {
            body["seasons"] = if req.seasons.is_empty() {
                Value::from("all")
            } else {
                Value::from(req.seasons.clone())
            };
        }
        self.send(Method::POST, "/request", &[], Some(&body)).await
    }

    /// The user's latest requests, newest first, each with the title, year
    /// and poster of what was requested added on.
    pub async fn requests(&self, user_id: u64, take: u32) -> Result<Vec<Value>> {
        let page = self
            .get(
                "/request",
                &[
                    ("take", take.to_string()),
                    ("skip", "0".into()),
                    ("sort", "added".into()),
                    ("requestedBy", user_id.to_string()),
                ],
            )
            .await?;
        let mut requests = match page.get("results") {
            Some(Value::Array(r)) => r.clone(),
            _ => Vec::new(),
        };
        let keys: Vec<(MediaType, Option<u64>)> = requests
            .iter()
            .map(|r| {
                let media = &r["media"];
                let kind = match media["mediaType"].as_str() {
                    Some("tv") => MediaType::Tv,
                    _ => MediaType::Movie,
                };
                (kind, media["tmdbId"].as_u64())
            })
            .collect();
        let lookups = keys.into_iter().map(|(kind, id)| async move {
            match id {
                Some(id) => self.details(kind, id).await.ok(),
                None => None,
            }
        });
        for (r, details) in requests.iter_mut().zip(join_all(lookups).await) {
            if let Some(d) = details {
                add_summary(r, &d);
            }
        }
        Ok(requests)
    }

    /// Withdraws a request that hasn't been approved yet.
    pub async fn cancel(&self, request_id: u64) -> Result<()> {
        self.send(Method::DELETE, &format!("/request/{request_id}"), &[], None).await?;
        Ok(())
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        self.send(Method::GET, path, query, None).await
    }

    async fn send(&self, method: Method, path: &str, query: &[(&str, String)], body: Option<&Value>) -> Result<Value> {
        self.ensure_signed_in().await?;
        let resp = self.build(method.clone(), path, query, body).send().await?;
        // The session cookie expired or Seerr restarted: sign in again once.
        let resp = if matches!(resp.status(), StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
            && matches!(self.auth, Auth::Plex(_))
        {
            self.sign_in().await?;
            self.build(method, path, query, body).send().await?
        } else {
            resp
        };
        let resp = check(resp).await?;
        let text = resp.text().await?;
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(bad_json)
    }

    fn build(&self, method: Method, path: &str, query: &[(&str, String)], body: Option<&Value>) -> reqwest::RequestBuilder {
        let mut url = format!("{}{path}", self.api);
        for (i, (k, v)) in query.iter().enumerate() {
            url.push(if i == 0 { '?' } else { '&' });
            url.push_str(k);
            url.push('=');
            url.push_str(&encode(v));
        }
        let mut req = self.http.request(method, url).header("Accept", "application/json");
        if let Auth::ApiKey(key) = &self.auth {
            req = req.header("X-Api-Key", key);
        }
        if let Some(body) = body {
            req = req.json(body);
        }
        req
    }

    async fn ensure_signed_in(&self) -> Result<()> {
        if matches!(self.auth, Auth::ApiKey(_)) {
            return Ok(());
        }
        let mut signed_in = self.signed_in.lock().await;
        if !*signed_in {
            self.sign_in_locked().await?;
            *signed_in = true;
        }
        Ok(())
    }

    async fn sign_in(&self) -> Result<()> {
        let mut signed_in = self.signed_in.lock().await;
        *signed_in = false;
        self.sign_in_locked().await?;
        *signed_in = true;
        Ok(())
    }

    async fn sign_in_locked(&self) -> Result<()> {
        let Auth::Plex(token) = &self.auth else { return Ok(()) };
        let resp = self
            .http
            .post(format!("{}/auth/plex", self.api))
            .header("Accept", "application/json")
            .json(&serde_json::json!({ "authToken": token }))
            .send()
            .await?;
        match resp.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(Error::PlexSignIn),
            _ => check(resp).await.map(|_| ()),
        }
    }
}

/// Accepts what people paste: `192.168.1.10:5055`, a trailing slash, or the
/// API path itself. Returns `scheme://host[:port][/base]`.
pub fn normalize_url(input: &str) -> Result<String> {
    let mut url = input.trim().trim_end_matches('/').to_owned();
    if url.is_empty() {
        return Err(Error::BadUrl(input.to_owned()));
    }
    if !url.contains("://") {
        url = format!("http://{url}");
    }
    if let Some(stripped) = url.strip_suffix("/api/v1") {
        url = stripped.to_owned();
    }
    let parsed = reqwest::Url::parse(&url).map_err(|_| Error::BadUrl(input.to_owned()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(Error::BadUrl(input.to_owned()));
    }
    Ok(url.trim_end_matches('/').to_owned())
}

/// Percent-encodes everything but unreserved characters. Seerr's request
/// validator rejects raw `!'()*`, which form encoding leaves alone.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn has_4k(services: &Value) -> bool {
    services
        .as_array()
        .is_some_and(|s| s.iter().any(|s| s["is4k"].as_bool() == Some(true)))
}

/// Copies the title, year and poster of `details` onto a request.
fn add_summary(request: &mut Value, details: &Value) {
    let title = details["title"].as_str().or_else(|| details["name"].as_str());
    let date = details["releaseDate"].as_str().or_else(|| details["firstAirDate"].as_str());
    request["title"] = title.map(Value::from).unwrap_or(Value::Null);
    request["year"] = date.and_then(|d| d.get(..4)).map(Value::from).unwrap_or(Value::Null);
    request["posterPath"] = details["posterPath"].clone();
}

fn bad_json(e: serde_json::Error) -> Error {
    Error::Status {
        status: StatusCode::BAD_GATEWAY,
        message: format!("unexpected response: {e}"),
    }
}

async fn check(resp: reqwest::Response) -> Result<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    Err(Error::Status { status, message: error_message(&body) })
}

/// Seerr answers errors with `{"message": …}`, or `{"error": …}` from older
/// routes; fall back to the raw body.
fn error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["message"].as_str().or_else(|| v["error"].as_str()).map(str::to_owned))
        .unwrap_or_else(|| body.chars().take(200).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_pasted_addresses() {
        assert_eq!(normalize_url("192.168.1.109:5055").unwrap(), "http://192.168.1.109:5055");
        assert_eq!(normalize_url(" http://192.168.1.109:5055/ ").unwrap(), "http://192.168.1.109:5055");
        assert_eq!(normalize_url("https://seerr.example.com/api/v1/").unwrap(), "https://seerr.example.com");
        assert_eq!(normalize_url("https://example.com/seerr").unwrap(), "https://example.com/seerr");
        assert!(normalize_url("").is_err());
        assert!(normalize_url("ftp://host").is_err());
    }

    #[test]
    fn encodes_search_terms_strictly() {
        assert_eq!(encode("The Office (US)"), "The%20Office%20%28US%29");
        assert_eq!(encode("Amélie!"), "Am%C3%A9lie%21");
        assert_eq!(encode("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn reads_error_messages() {
        assert_eq!(error_message(r#"{"message":"Request already exists"}"#), "Request already exists");
        assert_eq!(error_message(r#"{"error":"Unauthorized"}"#), "Unauthorized");
        assert_eq!(error_message("Bad Gateway"), "Bad Gateway");
    }

    #[test]
    fn summarizes_requests() {
        let mut movie = serde_json::json!({ "id": 1 });
        add_summary(&mut movie, &serde_json::json!({ "title": "Dune", "releaseDate": "2021-09-15", "posterPath": "/d.jpg" }));
        assert_eq!(movie["title"], "Dune");
        assert_eq!(movie["year"], "2021");
        assert_eq!(movie["posterPath"], "/d.jpg");

        let mut show = serde_json::json!({ "id": 2 });
        add_summary(&mut show, &serde_json::json!({ "name": "Severance", "firstAirDate": "2022-02-18" }));
        assert_eq!(show["title"], "Severance");
        assert_eq!(show["year"], "2022");
        assert!(show["posterPath"].is_null());
    }

    #[test]
    fn builds_browse_queries() {
        let b: Browse = serde_json::from_value(serde_json::json!({
            "sortBy": "vote_average.desc", "genre": 18, "dateFrom": "2010-01-01", "dateTo": "", "minRating": 7.5, "minVotes": 200
        }))
        .unwrap();
        assert_eq!(
            b.query(MediaType::Movie, 2),
            vec![
                ("page", "2".to_owned()),
                ("sortBy", "vote_average.desc".to_owned()),
                ("genre", "18".to_owned()),
                ("primaryReleaseDateGte", "2010-01-01".to_owned()),
                ("voteAverageGte", "7.5".to_owned()),
                ("voteCountGte", "200".to_owned()),
            ]
        );
        let tv = Browse { date_to: Some("2019-12-31".into()), ..Default::default() };
        assert_eq!(tv.query(MediaType::Tv, 1), vec![("page", "1".to_owned()), ("firstAirDateLte", "2019-12-31".to_owned())]);
        assert_eq!(Browse::default().query(MediaType::Movie, 1), vec![("page", "1".to_owned())]);
    }

    #[test]
    fn spots_4k_services() {
        assert!(has_4k(&serde_json::json!([{ "is4k": false }, { "is4k": true }])));
        assert!(!has_4k(&serde_json::json!([{ "is4k": false }])));
        assert!(!has_4k(&serde_json::json!({ "message": "Forbidden" })));
    }

    #[test]
    fn reads_request_bodies_from_the_app() {
        let r: NewRequest = serde_json::from_value(serde_json::json!({ "mediaType": "tv", "tmdbId": 95396, "seasons": [1, 2] })).unwrap();
        assert_eq!(r.media_type, MediaType::Tv);
        assert_eq!(r.seasons, vec![1, 2]);
        assert!(!r.is_4k);
    }
}
