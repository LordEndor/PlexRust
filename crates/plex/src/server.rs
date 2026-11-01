use std::time::{Duration, Instant};

use futures::future::join_all;
use serde::{Deserialize, Serialize};

use crate::client::PlexClient;
use crate::error::{Error, Result, check};
use crate::resources::{Connection, Resource};

const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

/// A reachable Plex Media Server: the base URI that answered plus the token
/// to use with it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConnection {
    pub machine_id: String,
    pub name: String,
    pub uri: String,
    pub token: String,
    pub local: bool,
    pub relay: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySection {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
}

#[derive(Deserialize)]
struct Container<T> {
    #[serde(rename = "MediaContainer")]
    media_container: T,
}

#[derive(Deserialize)]
struct Directories {
    #[serde(default, rename = "Directory")]
    directory: Vec<LibrarySection>,
}

impl PlexClient {
    /// Probes every connection of `server` at once and keeps the best one
    /// that answers: direct local first, then direct remote, then relay,
    /// fastest within each group.
    pub async fn connect(&self, server: &Resource, account_token: &str) -> Result<ServerConnection> {
        let token = server.access_token.as_deref().unwrap_or(account_token).to_owned();
        let probes = server.connections.iter().map(|c| self.probe(c, &token));
        let mut ok: Vec<(&Connection, Duration)> = server
            .connections
            .iter()
            .zip(join_all(probes).await)
            .filter_map(|(c, r)| r.map(|d| (c, d)))
            .collect();
        ok.sort_by_key(|(c, d)| rank(c, *d));
        let (best, _) = ok.first().ok_or(Error::Unreachable)?;
        Ok(ServerConnection {
            machine_id: server.client_identifier.clone(),
            name: server.name.clone(),
            uri: best.uri.trim_end_matches('/').to_owned(),
            token,
            local: best.local,
            relay: best.relay,
        })
    }

    async fn probe(&self, conn: &Connection, token: &str) -> Option<Duration> {
        let start = Instant::now();
        let resp = self
            .http
            .get(format!("{}/identity", conn.uri.trim_end_matches('/')))
            .header("X-Plex-Token", token)
            .timeout(PROBE_TIMEOUT)
            .send()
            .await
            .ok()?;
        resp.status().is_success().then(|| start.elapsed())
    }

    pub async fn library_sections(&self, server: &ServerConnection) -> Result<Vec<LibrarySection>> {
        let resp = self
            .http
            .get(format!("{}/library/sections", server.uri))
            .header("X-Plex-Token", &server.token)
            .send()
            .await?;
        let c: Container<Directories> = check(resp).await?.json().await?;
        Ok(c.media_container.directory)
    }
}

/// Sort key for working connections, best first: direct before relay, local
/// before remote, IPv4 before IPv6, then fastest. IPv4 comes first because
/// servers often don't count IPv6 addresses as part of the LAN, so they treat
/// the app as remote and cap its bitrate (high-bitrate 4K then fails to play).
fn rank(c: &Connection, latency: Duration) -> (bool, bool, bool, Duration) {
    (c.relay, !c.local, c.ipv6, latency)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_local_ipv4() {
        let conn = |uri: &str, local, relay, ipv6| Connection { uri: uri.into(), local, relay, ipv6 };
        let ms = Duration::from_millis;
        let mut found = vec![
            (conn("relay", false, true, false), ms(5)),
            (conn("v6", true, false, true), ms(1)),
            (conn("remote", false, false, false), ms(1)),
            (conn("v4", true, false, false), ms(9)),
        ];
        found.sort_by_key(|(c, d)| rank(c, *d));
        let order: Vec<_> = found.iter().map(|(c, _)| c.uri.as_str()).collect();
        assert_eq!(order, ["v4", "v6", "remote", "relay"]);
    }

    #[test]
    fn parses_sections() {
        let json = r#"{"MediaContainer":{"size":2,"Directory":[
            {"key":"1","type":"movie","title":"Movies","agent":"tv.plex.agents.movie"},
            {"key":"2","type":"show","title":"TV Shows"}]}}"#;
        let c: Container<Directories> = serde_json::from_str(json).unwrap();
        assert_eq!(c.media_container.directory[1].kind, "show");
    }
}

impl PlexClient {
    /// An image from `server`, resized by its photo transcoder. `path` is a
    /// library path such as `/library/metadata/1/thumb/2` or an absolute URL
    /// (cast photos). Falls back to the original image if the transcoder
    /// refuses. Returns the bytes and their content type.
    pub async fn image(
        &self,
        server: &ServerConnection,
        path: &str,
        width: u32,
        height: u32,
    ) -> Result<(Vec<u8>, String)> {
        let (w, h) = (width.to_string(), height.to_string());
        let transcoded = self
            .http
            .get(format!("{}/photo/:/transcode", server.uri))
            .query(&[("width", w.as_str()), ("height", &h), ("minSize", "1"), ("upscale", "1"), ("url", path)])
            .header("X-Plex-Token", &server.token)
            .header("Accept", "image/*")
            .send()
            .await;
        let resp = match transcoded {
            Ok(r) if r.status().is_success() => r,
            _ if path.starts_with('/') => {
                let r = self
                    .http
                    .get(format!("{}{path}", server.uri))
                    .header("X-Plex-Token", &server.token)
                    .header("Accept", "image/*")
                    .send()
                    .await?;
                check(r).await?
            }
            Ok(r) => check(r).await?,
            Err(e) => return Err(e.into()),
        };
        let kind = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/jpeg")
            .to_owned();
        Ok((resp.bytes().await?.to_vec(), kind))
    }
}
