//! The Plex account's watchlist, kept by plex.tv's Discover service rather
//! than by any one server.

use serde::Deserialize;

use crate::client::PlexClient;
use crate::error::{Result, check};
use crate::library::Metadata;

const DISCOVER: &str = "https://discover.provider.plex.tv";

#[derive(Deserialize)]
struct Body {
    #[serde(rename = "MediaContainer")]
    container: Container,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Container {
    #[serde(rename = "Metadata")]
    metadata: Vec<Metadata>,
    #[serde(rename = "totalSize")]
    total_size: Option<u32>,
}

/// Discover's id for a title: the last part of its `plex://` guid.
pub fn discover_id(guid: &str) -> Option<&str> {
    guid.strip_prefix("plex://")?.rsplit('/').next().filter(|id| !id.is_empty())
}

impl PlexClient {
    /// Everything on the account's watchlist, most recently added first.
    /// Thumbnails are full `https://` URLs on Plex's image servers.
    pub async fn watchlist(&self, account_token: &str) -> Result<Vec<Metadata>> {
        let mut items = Vec::new();
        // Discover pages through the list 100 at a time.
        loop {
            let start = items.len().to_string();
            let resp = self
                .http
                .get(format!("{DISCOVER}/library/sections/watchlist/all"))
                .query(&[
                    ("sort", "watchlistedAt:desc"),
                    ("includeGuids", "1"),
                    ("X-Plex-Container-Start", start.as_str()),
                    ("X-Plex-Container-Size", "100"),
                ])
                .header("X-Plex-Token", account_token)
                .send()
                .await?;
            let page = check(resp).await?.json::<Body>().await?.container;
            let got = page.metadata.len();
            items.extend(page.metadata);
            let total = page.total_size.unwrap_or(0) as usize;
            if got == 0 || items.len() >= total || items.len() >= 1000 {
                break;
            }
        }
        Ok(items)
    }

    /// Adds a title to the watchlist, or takes it off. `guid` is its
    /// `plex://` id.
    pub async fn set_watchlisted(&self, account_token: &str, guid: &str, on: bool) -> Result<()> {
        let id = discover_id(guid).unwrap_or(guid);
        let action = if on { "addToWatchlist" } else { "removeFromWatchlist" };
        let resp = self
            .http
            .put(format!("{DISCOVER}/actions/{action}"))
            .query(&[("ratingKey", id)])
            .header("X-Plex-Token", account_token)
            .send()
            .await?;
        check(resp).await?;
        Ok(())
    }

    /// Whether a title is on the watchlist.
    pub async fn is_watchlisted(&self, account_token: &str, guid: &str) -> Result<bool> {
        let id = discover_id(guid).unwrap_or(guid);
        let resp = self
            .http
            .get(format!("{DISCOVER}/library/metadata/{id}/userState"))
            .header("X-Plex-Token", account_token)
            .send()
            .await?;
        let body: serde_json::Value = check(resp).await?.json().await?;
        Ok(watchlisted_at(&body).is_some())
    }
}

/// `watchlistedAt` from a userState reply, whether Plex sends UserState as
/// one object or a list of them.
fn watchlisted_at(body: &serde_json::Value) -> Option<i64> {
    let state = &body["MediaContainer"]["UserState"];
    let one = if state.is_array() { &state[0] } else { state };
    one["watchlistedAt"].as_i64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discover_id_from_guid() {
        assert_eq!(discover_id("plex://movie/5d7768ba96b655001fdc0408"), Some("5d7768ba96b655001fdc0408"));
        assert_eq!(discover_id("com.plexapp.agents.imdb://tt1"), None);
        assert_eq!(discover_id("plex://show/"), None);
    }

    #[test]
    fn reads_user_state_either_shape() {
        let one = serde_json::json!({"MediaContainer":{"UserState":{"watchlistedAt":1700000000}}});
        let list = serde_json::json!({"MediaContainer":{"UserState":[{"watchlistedAt":5}]}});
        let none = serde_json::json!({"MediaContainer":{"UserState":{"viewCount":1}}});
        assert_eq!(watchlisted_at(&one), Some(1700000000));
        assert_eq!(watchlisted_at(&list), Some(5));
        assert_eq!(watchlisted_at(&none), None);
    }

    #[test]
    fn parses_watchlist_page() {
        let json = r#"{"MediaContainer":{"totalSize":1,"Metadata":[{"ratingKey":"5d77","guid":"plex://movie/5d77","type":"movie","title":"Heat","year":1995,"thumb":"https://metadata-static.plex.tv/x.jpg","Guid":[{"id":"tmdb://949"}]}]}}"#;
        let body: Body = serde_json::from_str(json).unwrap();
        let m = &body.container.metadata[0];
        assert_eq!(m.guid.as_deref(), Some("plex://movie/5d77"));
        assert_eq!(m.guids[0].id, "tmdb://949");
    }
}
