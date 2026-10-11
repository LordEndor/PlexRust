use serde::{Deserialize, Serialize};

use crate::client::PlexClient;
use crate::error::{Result, check};
use crate::server::ServerConnection;

/// Any library item: movie, show, season, episode, … Plex uses one shape for
/// all of them and leaves out what doesn't apply, so every field is optional.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Metadata {
    pub rating_key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub title_sort: Option<String>,
    pub parent_rating_key: Option<String>,
    pub grandparent_rating_key: Option<String>,
    pub parent_title: Option<String>,
    pub grandparent_title: Option<String>,
    pub summary: Option<String>,
    pub tagline: Option<String>,
    pub year: Option<i32>,
    pub thumb: Option<String>,
    pub art: Option<String>,
    pub parent_thumb: Option<String>,
    pub grandparent_thumb: Option<String>,
    pub grandparent_art: Option<String>,
    /// Milliseconds.
    pub duration: Option<u64>,
    /// Resume position in milliseconds.
    pub view_offset: Option<u64>,
    pub view_count: Option<u32>,
    /// Episode or season number.
    pub index: Option<i32>,
    /// Season number of an episode.
    pub parent_index: Option<i32>,
    /// Episodes in a show or season.
    pub leaf_count: Option<u32>,
    pub viewed_leaf_count: Option<u32>,
    /// Seasons in a show.
    pub child_count: Option<u32>,
    pub content_rating: Option<String>,
    pub rating: Option<f64>,
    pub audience_rating: Option<f64>,
    pub studio: Option<String>,
    pub originally_available_at: Option<String>,
    pub added_at: Option<i64>,
    #[serde(rename = "Genre")]
    pub genre: Vec<Tag>,
    #[serde(rename = "Director")]
    pub director: Vec<Tag>,
    #[serde(rename = "Role")]
    pub role: Vec<Tag>,
    #[serde(rename = "Media")]
    pub media: Vec<Media>,
    /// Intro and credits markers (needs `includeMarkers=1`).
    #[serde(rename = "Marker")]
    pub markers: Vec<Marker>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Marker {
    /// `intro` or `credits`.
    #[serde(rename = "type")]
    pub kind: String,
    /// Milliseconds.
    pub start_time_offset: u64,
    pub end_time_offset: u64,
    #[serde(rename = "final")]
    pub is_final: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tag {
    pub tag: String,
    /// Character name, for cast members.
    pub role: Option<String>,
    pub thumb: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Media {
    pub video_resolution: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub audio_channels: Option<u32>,
    pub container: Option<String>,
    #[serde(rename = "Part")]
    pub part: Vec<Part>,
}

/// One file of a media version.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Part {
    pub id: Option<u64>,
    /// Server path that streams the file, e.g. `/library/parts/12/1700000000/file.mkv`.
    pub key: Option<String>,
    pub file: Option<String>,
    pub size: Option<u64>,
    pub container: Option<String>,
    #[serde(rename = "Stream")]
    pub stream: Vec<Stream>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Stream {
    pub id: Option<u64>,
    /// 1 video, 2 audio, 3 subtitle.
    pub stream_type: Option<u8>,
    pub codec: Option<String>,
    pub language: Option<String>,
    pub language_code: Option<String>,
    pub display_title: Option<String>,
    pub title: Option<String>,
    /// Set for subtitles stored next to the video rather than inside it.
    pub key: Option<String>,
    pub forced: Option<bool>,
    /// Dolby Vision profile of a video stream, when it has one.
    #[serde(rename = "DOVIProfile")]
    pub dovi_profile: Option<u8>,
}

/// A row of items, as shown on the home screen or in search results.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Hub {
    pub hub_identifier: String,
    pub title: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "Metadata")]
    pub metadata: Vec<Metadata>,
}

/// One page of a library listing plus the library's total item count.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub items: Vec<Metadata>,
    pub total: u32,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Body {
    #[serde(rename = "MediaContainer")]
    container: MediaContainer,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct MediaContainer {
    total_size: Option<u32>,
    size: Option<u32>,
    #[serde(rename = "Metadata")]
    metadata: Vec<Metadata>,
    #[serde(rename = "Hub")]
    hub: Vec<Hub>,
}

impl PlexClient {
    async fn container(&self, server: &ServerConnection, path: &str, query: &[(&str, &str)]) -> Result<MediaContainer> {
        let resp = self
            .http
            .get(format!("{}{path}", server.uri))
            .query(query)
            .header("X-Plex-Token", &server.token)
            .send()
            .await?;
        let body: Body = check(resp).await?.json().await?;
        Ok(body.container)
    }

    /// The home screen rows: Continue Watching, Recently Added, and so on.
    pub async fn home_hubs(&self, server: &ServerConnection) -> Result<Vec<Hub>> {
        let c = self
            .container(server, "/hubs", &[("count", "20"), ("includeLibraryPlaylists", "0")])
            .await?;
        Ok(c.hub.into_iter().filter(|h| !h.metadata.is_empty()).collect())
    }

    /// `size` items of a library section starting at `start`, sorted by
    /// `sort` (a Plex sort key such as `titleSort` or `addedAt:desc`).
    pub async fn section_items(
        &self,
        server: &ServerConnection,
        section: &str,
        start: u32,
        size: u32,
        sort: &str,
    ) -> Result<Page> {
        let (start, size) = (start.to_string(), size.to_string());
        let c = self
            .container(
                server,
                &format!("/library/sections/{section}/all"),
                &[
                    ("sort", sort),
                    ("X-Plex-Container-Start", &start),
                    ("X-Plex-Container-Size", &size),
                ],
            )
            .await?;
        let total = c.total_size.or(c.size).unwrap_or(c.metadata.len() as u32);
        Ok(Page { items: c.metadata, total })
    }

    /// Full details for one item, including cast, genres and media info.
    pub async fn metadata(&self, server: &ServerConnection, rating_key: &str) -> Result<Option<Metadata>> {
        let c = self
            .container(server, &format!("/library/metadata/{rating_key}"), &[("includeMarkers", "1")])
            .await?;
        Ok(c.metadata.into_iter().next())
    }

    /// Seasons of a show, or episodes of a season.
    pub async fn children(&self, server: &ServerConnection, rating_key: &str) -> Result<Vec<Metadata>> {
        let c = self
            .container(server, &format!("/library/metadata/{rating_key}/children"), &[])
            .await?;
        Ok(c.metadata)
    }

    pub async fn search(&self, server: &ServerConnection, query: &str) -> Result<Vec<Hub>> {
        let c = self
            .container(server, "/hubs/search", &[("query", query), ("limit", "12")])
            .await?;
        Ok(c.hub.into_iter().filter(|h| !h.metadata.is_empty()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_episode_with_unknown_fields() {
        let json = r#"{"MediaContainer":{"size":1,"totalSize":240,"Metadata":[{
            "ratingKey":"123","key":"/library/metadata/123","type":"episode","title":"Pilot",
            "grandparentTitle":"Show","parentIndex":1,"index":1,"duration":3600000,
            "viewOffset":120000,"thumb":"/library/metadata/123/thumb/1","rating":8.1,
            "Guid":[{"id":"imdb://tt1"}],"Media":[{"videoResolution":"4k","Part":[{"file":"x"}]}],
            "Role":[{"tag":"Actor","role":"Hero","thumb":"https://x/y.jpg"}]}]}}"#;
        let body: Body = serde_json::from_str(json).unwrap();
        let m = &body.container.metadata[0];
        assert_eq!(body.container.total_size, Some(240));
        assert_eq!(m.kind, "episode");
        assert_eq!(m.view_offset, Some(120_000));
        assert_eq!(m.media[0].video_resolution.as_deref(), Some("4k"));
        assert_eq!(m.role[0].role.as_deref(), Some("Hero"));
    }

    #[test]
    fn parses_dolby_vision_profile() {
        let json = r#"{"MediaContainer":{"Metadata":[{"ratingKey":"9","type":"movie","title":"Collateral",
            "Media":[{"Part":[{"key":"/library/parts/1/2/file.mkv","Stream":[
                {"streamType":1,"codec":"hevc","DOVIPresent":true,"DOVIProfile":7,"DOVIBLCompatID":6},
                {"streamType":2,"codec":"dca"}]}]}]}]}}"#;
        let body: Body = serde_json::from_str(json).unwrap();
        let streams = &body.container.metadata[0].media[0].part[0].stream;
        assert_eq!(streams[0].dovi_profile, Some(7));
        assert_eq!(streams[1].dovi_profile, None);
    }

    #[test]
    fn parses_hubs_and_serializes_camel_case() {
        let json = r#"{"MediaContainer":{"Hub":[
            {"hubIdentifier":"home.continue","title":"Continue Watching","type":"mixed","Metadata":[{"ratingKey":"1","type":"movie","title":"A"}]},
            {"hubIdentifier":"home.empty","title":"Empty","type":"movie"}]}}"#;
        let body: Body = serde_json::from_str(json).unwrap();
        assert_eq!(body.container.hub.len(), 2);
        let out = serde_json::to_value(&body.container.hub[0].metadata[0]).unwrap();
        assert_eq!(out["ratingKey"], "1");
        assert_eq!(out["type"], "movie");
    }
}
