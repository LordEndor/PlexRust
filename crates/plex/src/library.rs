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
    /// For extras: 1 is a trailer.
    pub extra_type: Option<u32>,
    /// Chapters from the file (needs `includeChapters=1`).
    #[serde(rename = "Chapter")]
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Chapter {
    /// The chapter's title, when the file names it.
    pub tag: Option<String>,
    pub index: Option<u32>,
    /// Milliseconds.
    pub start_time_offset: u64,
    pub end_time_offset: u64,
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
    /// Overall bitrate in kbps.
    pub bitrate: Option<u32>,
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
    /// `sd` when the server has generated seek-bar thumbnails for this file.
    pub indexes: Option<String>,
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
    #[serde(rename = "Directory")]
    directory: Vec<Directory>,
}

/// A filter value offered by a library, such as one genre or decade.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Directory {
    /// The value to filter by.
    pub key: String,
    pub title: String,
}

/// What a library listing is narrowed down to. Empty means everything.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Filters {
    pub genre: Option<String>,
    pub decade: Option<String>,
    /// `4k`, `1080`, `720`, `480` or `sd`.
    pub resolution: Option<String>,
    pub unwatched: bool,
    /// Plex can't filter on bitrate, so this one is applied here.
    pub min_bitrate_kbps: Option<u32>,
}

impl Filters {
    /// The part Plex filters on, as query parameters.
    fn query(&self) -> Vec<(&'static str, String)> {
        let mut q = Vec::new();
        if let Some(g) = &self.genre {
            q.push(("genre", g.clone()));
        }
        if let Some(d) = &self.decade {
            q.push(("decade", d.clone()));
        }
        if let Some(r) = &self.resolution {
            q.push(("resolution", r.clone()));
        }
        if self.unwatched {
            q.push(("unwatched", "1".into()));
        }
        q
    }

    /// Whether `item` passes the filters Plex can't apply.
    pub fn keeps(&self, item: &Metadata) -> bool {
        self.min_bitrate_kbps
            .is_none_or(|min| item.media.iter().any(|m| m.bitrate.is_some_and(|b| b >= min)))
    }
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

    /// A page of a library section (`page` is start and size), sorted by
    /// `sort` and narrowed down by `filters`. With a bitrate filter the whole
    /// matching library comes back in one go, since Plex can't page through a
    /// filter it doesn't apply.
    pub async fn section_filtered(
        &self,
        server: &ServerConnection,
        section: &str,
        page: Option<(u32, u32)>,
        sort: &str,
        filters: &Filters,
    ) -> Result<Page> {
        let mut query: Vec<(&str, String)> = vec![("sort", sort.to_owned())];
        query.extend(filters.query());
        if let Some((start, size)) = page.filter(|_| filters.min_bitrate_kbps.is_none()) {
            query.push(("X-Plex-Container-Start", start.to_string()));
            query.push(("X-Plex-Container-Size", size.to_string()));
        }
        let query: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let c = self
            .container(server, &format!("/library/sections/{section}/all"), &query)
            .await?;
        if filters.min_bitrate_kbps.is_some() {
            let items: Vec<Metadata> = c.metadata.into_iter().filter(|m| filters.keeps(m)).collect();
            let total = items.len() as u32;
            return Ok(Page { items, total });
        }
        let total = c.total_size.or(c.size).unwrap_or(c.metadata.len() as u32);
        Ok(Page { items: c.metadata, total })
    }

    /// Values a library can be filtered by: `genre` or `decade`.
    pub async fn filter_values(&self, server: &ServerConnection, section: &str, field: &str) -> Result<Vec<Directory>> {
        let c = self
            .container(server, &format!("/library/sections/{section}/{field}"), &[])
            .await?;
        Ok(c.directory)
    }

    /// A library's collections.
    pub async fn collections(&self, server: &ServerConnection, section: &str) -> Result<Vec<Metadata>> {
        let c = self
            .container(server, &format!("/library/sections/{section}/collections"), &[])
            .await?;
        Ok(c.metadata)
    }

    /// The movies or shows in a collection.
    pub async fn collection_items(&self, server: &ServerConnection, collection: &str) -> Result<Vec<Metadata>> {
        let c = self
            .container(server, &format!("/library/collections/{collection}/children"), &[])
            .await?;
        Ok(c.metadata)
    }

    /// An item's trailers, from its extras.
    pub async fn trailers(&self, server: &ServerConnection, rating_key: &str) -> Result<Vec<Metadata>> {
        let c = self
            .container(server, &format!("/library/metadata/{rating_key}/extras"), &[])
            .await?;
        Ok(c.metadata.into_iter().filter(|m| m.extra_type == Some(1)).collect())
    }

    /// Full details for one item, including cast, genres and media info.
    pub async fn metadata(&self, server: &ServerConnection, rating_key: &str) -> Result<Option<Metadata>> {
        let c = self
            .container(server, &format!("/library/metadata/{rating_key}"), &[("includeMarkers", "1"), ("includeChapters", "1")])
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

    /// The episodes around `episode` in its show: the one before it and
    /// every one after it, in season and episode order. Specials only count
    /// when `episode` is itself a special.
    pub async fn episode_neighbours(
        &self,
        server: &ServerConnection,
        episode: &Metadata,
    ) -> Result<(Option<Metadata>, Vec<Metadata>)> {
        let Some(show) = &episode.grandparent_rating_key else {
            return Ok((None, Vec::new()));
        };
        let all = self
            .container(server, &format!("/library/metadata/{show}/allLeaves"), &[])
            .await?
            .metadata;
        Ok(neighbours(all, episode))
    }

    pub async fn search(&self, server: &ServerConnection, query: &str) -> Result<Vec<Hub>> {
        let c = self
            .container(server, "/hubs/search", &[("query", query), ("limit", "12")])
            .await?;
        Ok(c.hub.into_iter().filter(|h| !h.metadata.is_empty()).collect())
    }
}

/// The item with the lowest `index` above `after`.
fn neighbours(mut all: Vec<Metadata>, episode: &Metadata) -> (Option<Metadata>, Vec<Metadata>) {
    let specials = episode.parent_index == Some(0);
    all.retain(|m| (m.parent_index == Some(0)) == specials);
    all.sort_by_key(|m| (m.parent_index, m.index));
    let Some(at) = all.iter().position(|m| m.rating_key == episode.rating_key) else {
        return (None, Vec::new());
    };
    let after = all.split_off(at + 1);
    all.pop();
    (all.pop(), after)
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
    fn bitrate_filter_keeps_any_fast_version() {
        let item = |rates: &[u32]| Metadata {
            media: rates.iter().map(|&b| Media { bitrate: Some(b), ..Default::default() }).collect(),
            ..Default::default()
        };
        let f = Filters { min_bitrate_kbps: Some(20_000), ..Default::default() };
        assert!(f.keeps(&item(&[8_000, 40_000])));
        assert!(!f.keeps(&item(&[8_000])));
        assert!(!f.keeps(&item(&[])));
        assert!(Filters::default().keeps(&item(&[])));
    }

    #[test]
    fn filters_become_query_params() {
        let f = Filters { genre: Some("12".into()), unwatched: true, min_bitrate_kbps: Some(1), ..Default::default() };
        assert_eq!(f.query(), [("genre", "12".to_owned()), ("unwatched", "1".to_owned())]);
    }

    #[test]
    fn neighbours_cross_seasons_and_skip_specials() {
        let ep = |key: &str, season, index| Metadata {
            rating_key: key.into(),
            parent_index: Some(season),
            index: Some(index),
            ..Default::default()
        };
        let all = vec![ep("s2e1", 2, 1), ep("x1", 0, 1), ep("s1e2", 1, 2), ep("s1e1", 1, 1), ep("s2e2", 2, 2)];
        let keys = |v: &[Metadata]| v.iter().map(|m| m.rating_key.clone()).collect::<Vec<_>>();

        let (prev, after) = neighbours(all.clone(), &ep("s1e2", 1, 2));
        assert_eq!(prev.unwrap().rating_key, "s1e1");
        assert_eq!(keys(&after), ["s2e1", "s2e2"]);

        let (prev, after) = neighbours(all.clone(), &ep("s1e1", 1, 1));
        assert!(prev.is_none());
        assert_eq!(after.len(), 3);

        let (prev, after) = neighbours(all, &ep("s2e2", 2, 2));
        assert_eq!(prev.unwrap().rating_key, "s2e1");
        assert!(after.is_empty());
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
