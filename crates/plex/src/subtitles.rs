//! Searching for subtitles online and downloading them, through the server's
//! own subtitle agents (OpenSubtitles by default), like the Plex apps do.

use serde::{Deserialize, Serialize};

use crate::client::PlexClient;
use crate::error::{Result, check};
use crate::server::ServerConnection;

/// One subtitle the server found online for an item.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SubtitleResult {
    /// Handed back to [`PlexClient::download_subtitle`].
    pub key: String,
    pub codec: Option<String>,
    pub language: Option<String>,
    pub language_code: Option<String>,
    pub display_title: Option<String>,
    pub title: Option<String>,
    /// Where it came from, such as "OpenSubtitles".
    pub provider_title: Option<String>,
    /// How well it matches the file; higher is better.
    pub score: Option<f64>,
    pub hearing_impaired: Option<bool>,
    pub forced: Option<bool>,
    /// The release matches the file exactly.
    pub perfect_match: Option<bool>,
    /// Already downloaded for this item.
    pub downloaded: Option<bool>,
}

#[derive(Deserialize)]
struct Body {
    #[serde(rename = "MediaContainer")]
    container: Container,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Container {
    #[serde(rename = "Stream")]
    stream: Vec<SubtitleResult>,
}

impl PlexClient {
    /// Asks the server to search its subtitle agents for `rating_key`.
    /// `language` is a two-letter code such as `en`. Best matches first.
    pub async fn search_subtitles(
        &self,
        server: &ServerConnection,
        rating_key: &str,
        language: &str,
        hearing_impaired: bool,
    ) -> Result<Vec<SubtitleResult>> {
        // 0 prefers subtitles without hearing-impaired cues, 1 prefers them.
        let hi = if hearing_impaired { "1" } else { "0" };
        let resp = self
            .http
            .get(format!(
                "{}/library/metadata/{rating_key}/subtitles",
                server.uri
            ))
            .query(&[
                ("language", language),
                ("hearingImpaired", hi),
                ("forced", "0"),
            ])
            .header("X-Plex-Token", &server.token)
            .send()
            .await?;
        let mut results = check(resp).await?.json::<Body>().await?.container.stream;
        results.retain(|s| !s.key.is_empty());
        results.sort_by(|a, b| {
            (b.perfect_match.unwrap_or(false), b.score.unwrap_or(0.0))
                .partial_cmp(&(a.perfect_match.unwrap_or(false), a.score.unwrap_or(0.0)))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(results)
    }

    /// Downloads a search result and adds it to the item as a subtitle track.
    /// The server finishes in the background; the new track shows up in the
    /// item's metadata a moment later.
    pub async fn download_subtitle(
        &self,
        server: &ServerConnection,
        rating_key: &str,
        key: &str,
    ) -> Result<()> {
        let resp = self
            .http
            .put(format!(
                "{}/library/metadata/{rating_key}/subtitles",
                server.uri
            ))
            .query(&[("key", key)])
            .header("X-Plex-Token", &server.token)
            .send()
            .await?;
        check(resp).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_results() {
        let json = r#"{"MediaContainer":{"size":2,"Stream":[
            {"key":"/sub/1","codec":"srt","languageCode":"eng","displayTitle":"English (SRT)","providerTitle":"OpenSubtitles","score":80,"hearingImpaired":false},
            {"key":"/sub/2","codec":"srt","languageCode":"eng","title":"Movie.2020.1080p","score":95,"perfectMatch":true}
        ]}}"#;
        let body: Body = serde_json::from_str(json).unwrap();
        assert_eq!(body.container.stream.len(), 2);
        assert_eq!(body.container.stream[1].perfect_match, Some(true));
        assert_eq!(
            body.container.stream[0].provider_title.as_deref(),
            Some("OpenSubtitles")
        );
    }

    #[test]
    fn empty_search_is_fine() {
        let body: Body = serde_json::from_str(r#"{"MediaContainer":{"size":0}}"#).unwrap();
        assert!(body.container.stream.is_empty());
    }
}
