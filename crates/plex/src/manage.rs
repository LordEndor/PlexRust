//! Server housekeeping that needs the server owner (or an admin): scanning
//! libraries, refreshing and fixing metadata, posters and deleting files.

use serde::{Deserialize, Serialize};

use crate::client::PlexClient;
use crate::error::{Result, check};
use crate::server::ServerConnection;

/// A possible match for an item, from the library's agent.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchResult {
    /// Handed back to [`PlexClient::apply_match`].
    pub guid: String,
    pub name: String,
    pub year: Option<i32>,
    /// 0-100, how sure the agent is.
    pub score: Option<u32>,
    pub thumb: Option<String>,
    pub summary: Option<String>,
}

/// One poster Plex can use for an item.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Artwork {
    /// Handed back to [`PlexClient::set_poster`].
    pub rating_key: String,
    /// Image path or URL to show it with.
    pub thumb: Option<String>,
    pub key: Option<String>,
    pub provider: Option<String>,
    pub selected: Option<bool>,
}

#[derive(Deserialize)]
struct Body<T> {
    #[serde(rename = "MediaContainer")]
    container: T,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Matches {
    #[serde(rename = "SearchResult")]
    results: Vec<MatchResult>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Posters {
    #[serde(rename = "Metadata")]
    metadata: Vec<Artwork>,
}

/// Plex's number for an item type, used when editing.
pub fn type_number(kind: &str) -> Option<u8> {
    Some(match kind {
        "movie" => 1,
        "show" => 2,
        "season" => 3,
        "episode" => 4,
        _ => return None,
    })
}

impl PlexClient {
    async fn send(&self, req: reqwest::RequestBuilder, server: &ServerConnection) -> Result<reqwest::Response> {
        check(req.header("X-Plex-Token", &server.token).send().await?).await
    }

    /// Looks for new, changed or removed files in a library. With `force`,
    /// also refreshes every item's metadata.
    pub async fn scan_section(&self, server: &ServerConnection, section: &str, force: bool) -> Result<()> {
        let mut req = self.http.get(format!("{}/library/sections/{section}/refresh", server.uri));
        if force {
            req = req.query(&[("force", "1")]);
        }
        self.send(req, server).await?;
        Ok(())
    }

    /// Fetches an item's metadata again from its agent.
    pub async fn refresh_item(&self, server: &ServerConnection, rating_key: &str) -> Result<()> {
        let req = self.http.put(format!("{}/library/metadata/{rating_key}/refresh", server.uri));
        self.send(req, server).await?;
        Ok(())
    }

    /// Reads the files again for codecs, bitrate and so on.
    pub async fn analyze_item(&self, server: &ServerConnection, rating_key: &str) -> Result<()> {
        let req = self.http.put(format!("{}/library/metadata/{rating_key}/analyze", server.uri));
        self.send(req, server).await?;
        Ok(())
    }

    /// Deletes an item and its files from disk. The server only allows this
    /// with "Allow media deletion" turned on in its settings.
    pub async fn delete_item(&self, server: &ServerConnection, rating_key: &str) -> Result<()> {
        let req = self.http.delete(format!("{}/library/metadata/{rating_key}", server.uri));
        self.send(req, server).await?;
        Ok(())
    }

    /// Possible matches for an item, searched by `title` and `year`.
    pub async fn matches(
        &self,
        server: &ServerConnection,
        rating_key: &str,
        title: &str,
        year: Option<i32>,
    ) -> Result<Vec<MatchResult>> {
        let year = year.map(|y| y.to_string()).unwrap_or_default();
        let req = self
            .http
            .get(format!("{}/library/metadata/{rating_key}/matches", server.uri))
            .query(&[("manual", "1"), ("title", title), ("year", year.as_str())]);
        let body: Body<Matches> = self.send(req, server).await?.json().await?;
        Ok(body.container.results)
    }

    /// Matches an item to one of [`PlexClient::matches`]' results.
    pub async fn apply_match(&self, server: &ServerConnection, rating_key: &str, m: &MatchResult) -> Result<()> {
        let year = m.year.map(|y| y.to_string()).unwrap_or_default();
        let req = self
            .http
            .put(format!("{}/library/metadata/{rating_key}/match", server.uri))
            .query(&[("guid", m.guid.as_str()), ("name", m.name.as_str()), ("year", year.as_str())]);
        self.send(req, server).await?;
        Ok(())
    }

    /// Changes metadata fields, such as `title` or `summary`, and locks them
    /// so a refresh doesn't undo the change.
    pub async fn edit_item(
        &self,
        server: &ServerConnection,
        section: u64,
        rating_key: &str,
        kind: &str,
        fields: &[(String, String)],
    ) -> Result<()> {
        let kind = type_number(kind).ok_or("can't edit this kind of item").map_err(edit_error)?;
        let mut query = vec![("type".to_owned(), kind.to_string()), ("id".to_owned(), rating_key.to_owned())];
        for (field, value) in fields {
            query.push((format!("{field}.value"), value.clone()));
            query.push((format!("{field}.locked"), "1".to_owned()));
        }
        let req = self.http.put(format!("{}/library/sections/{section}/all", server.uri)).query(&query);
        self.send(req, server).await?;
        Ok(())
    }

    /// The posters Plex has for an item, from its agents and the files.
    pub async fn posters(&self, server: &ServerConnection, rating_key: &str) -> Result<Vec<Artwork>> {
        let req = self.http.get(format!("{}/library/metadata/{rating_key}/posters", server.uri));
        let body: Body<Posters> = self.send(req, server).await?.json().await?;
        Ok(body.container.metadata)
    }

    /// Uses one of [`PlexClient::posters`]' results as the item's poster.
    pub async fn set_poster(&self, server: &ServerConnection, rating_key: &str, poster: &str) -> Result<()> {
        let req = self
            .http
            .put(format!("{}/library/metadata/{rating_key}/poster", server.uri))
            .query(&[("url", poster)]);
        self.send(req, server).await?;
        Ok(())
    }
}

fn edit_error(msg: &str) -> crate::Error {
    crate::Error::Status { status: reqwest::StatusCode::BAD_REQUEST, body: msg.to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_matches_and_posters() {
        let m: Body<Matches> = serde_json::from_str(
            r#"{"MediaContainer":{"SearchResult":[{"guid":"plex://movie/1","name":"Heat","year":1995,"score":100}]}}"#,
        )
        .unwrap();
        assert_eq!(m.container.results[0].name, "Heat");
        let p: Body<Posters> = serde_json::from_str(
            r#"{"MediaContainer":{"Metadata":[{"ratingKey":"upload://posters/abc","thumb":"/library/metadata/1/file?url=x","selected":true,"provider":"tmdb"}]}}"#,
        )
        .unwrap();
        assert_eq!(p.container.metadata[0].selected, Some(true));
    }

    #[test]
    fn type_numbers() {
        assert_eq!(type_number("movie"), Some(1));
        assert_eq!(type_number("episode"), Some(4));
        assert_eq!(type_number("collection"), None);
    }
}
