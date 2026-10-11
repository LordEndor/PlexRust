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
        ok.sort_by_key(|(c, d)| (c.relay, !c.local, *d));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sections() {
        let json = r#"{"MediaContainer":{"size":2,"Directory":[
            {"key":"1","type":"movie","title":"Movies","agent":"tv.plex.agents.movie"},
            {"key":"2","type":"show","title":"TV Shows"}]}}"#;
        let c: Container<Directories> = serde_json::from_str(json).unwrap();
        assert_eq!(c.media_container.directory[1].kind, "show");
    }
}
