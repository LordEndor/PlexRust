use std::collections::HashSet;

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
    pub original_title: Option<String>,
    /// Such as "Director's Cut", for movies with several editions.
    pub edition_title: Option<String>,
    pub library_section_title: Option<String>,
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
    /// A playlist's poster, a mosaic of what's in it.
    pub composite: Option<String>,
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
    /// The account's own star rating, 0 to 10.
    pub user_rating: Option<f64>,
    pub studio: Option<String>,
    pub originally_available_at: Option<String>,
    pub added_at: Option<i64>,
    /// Unix seconds.
    pub updated_at: Option<i64>,
    /// Unix seconds.
    pub last_viewed_at: Option<i64>,
    /// For playlists: `video`, `audio` or `photo`.
    pub playlist_type: Option<String>,
    #[serde(rename = "Genre")]
    pub genre: Vec<Tag>,
    #[serde(rename = "Director")]
    pub director: Vec<Tag>,
    #[serde(rename = "Role")]
    pub role: Vec<Tag>,
    #[serde(rename = "Writer")]
    pub writer: Vec<Tag>,
    #[serde(rename = "Producer")]
    pub producer: Vec<Tag>,
    #[serde(rename = "Country")]
    pub country: Vec<Tag>,
    #[serde(rename = "Collection")]
    pub collection: Vec<Tag>,
    #[serde(rename = "Label")]
    pub label: Vec<Tag>,
    /// IDs in other databases, such as `imdb://tt0369339` (needs `includeGuids=1`).
    #[serde(rename = "Guid")]
    pub guids: Vec<Guid>,
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
#[serde(default)]
pub struct Guid {
    pub id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Media {
    pub video_resolution: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub aspect_ratio: Option<f64>,
    /// Such as `24p` or `PAL`.
    pub video_frame_rate: Option<String>,
    pub video_profile: Option<String>,
    /// Milliseconds.
    pub duration: Option<u64>,
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
    /// Milliseconds.
    pub duration: Option<u64>,
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
    /// Longer description, such as "English (EAC3 5.1)" with the track's title.
    pub extended_display_title: Option<String>,
    pub title: Option<String>,
    /// Kbps.
    pub bitrate: Option<u32>,
    /// Set for subtitles stored next to the video rather than inside it.
    pub key: Option<String>,
    pub forced: Option<bool>,
    pub default: Option<bool>,
    /// Codec profile, such as `main 10` or `dts-hd ma`.
    pub profile: Option<String>,
    pub bit_depth: Option<u8>,
    pub frame_rate: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// `bt2020` for HDR.
    pub color_primaries: Option<String>,
    /// `smpte2084` for HDR10 and Dolby Vision, `arib-std-b67` for HLG.
    pub color_trc: Option<String>,
    pub chroma_subsampling: Option<String>,
    pub channels: Option<u32>,
    /// Such as `5.1(side)`.
    pub audio_channel_layout: Option<String>,
    /// Hz.
    pub sampling_rate: Option<u32>,
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

    /// Whether a listing has to be fetched whole and paged locally.
    pub fn needs_whole_library(&self, sort: &str) -> bool {
        self.min_bitrate_kbps.is_some() || sort.starts_with("random")
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
        let mut hubs = c.hub;
        drop_on_deck_duplicates(&mut hubs);
        Ok(hubs.into_iter().filter(|h| !h.metadata.is_empty()).collect())
    }

    /// How many items a library holds: its movies or shows, or with `kind`
    /// another Plex type, such as 4 for a show library's episodes.
    pub async fn section_total(&self, server: &ServerConnection, section: &str, kind: Option<u8>) -> Result<u32> {
        let kind = kind.map(|k| k.to_string());
        let mut query = vec![("X-Plex-Container-Start", "0"), ("X-Plex-Container-Size", "0")];
        if let Some(k) = &kind {
            query.push(("type", k));
        }
        let c = self
            .container(server, &format!("/library/sections/{section}/all"), &query)
            .await?;
        Ok(c.total_size.or(c.size).unwrap_or_default())
    }

    /// The account's video playlists.
    pub async fn playlists(&self, server: &ServerConnection) -> Result<Vec<Metadata>> {
        let c = self.container(server, "/playlists", &[("playlistType", "video")]).await?;
        Ok(c.metadata)
    }

    /// One playlist's own details: title, poster, length.
    pub async fn playlist(&self, server: &ServerConnection, playlist: &str) -> Result<Option<Metadata>> {
        let c = self.container(server, &format!("/playlists/{playlist}"), &[]).await?;
        Ok(c.metadata.into_iter().next())
    }

    /// What's in a playlist, in its order.
    pub async fn playlist_items(&self, server: &ServerConnection, playlist: &str) -> Result<Vec<Metadata>> {
        let c = self.container(server, &format!("/playlists/{playlist}/items"), &[]).await?;
        Ok(c.metadata)
    }

    /// The items around `item` in a playlist: the one before it and every
    /// one after it.
    pub async fn playlist_neighbours(
        &self,
        server: &ServerConnection,
        playlist: &str,
        item: &str,
    ) -> Result<(Option<Metadata>, Vec<Metadata>)> {
        let mut all = self.playlist_items(server, playlist).await?;
        let Some(at) = all.iter().position(|m| m.rating_key == item) else {
            return Ok((None, Vec::new()));
        };
        let after = all.split_off(at + 1);
        all.pop();
        Ok((all.pop(), after))
    }

    /// A page of a library section (`page` is start and size), sorted by
    /// `sort` and narrowed down by `filters`. With a bitrate filter or random
    /// order the whole matching library comes back in one go: Plex can't page
    /// through a filter it doesn't apply, and shuffles again for every page.
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
        if let Some((start, size)) = page.filter(|_| !filters.needs_whole_library(sort)) {
            query.push(("X-Plex-Container-Start", start.to_string()));
            query.push(("X-Plex-Container-Size", size.to_string()));
        }
        let query: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let c = self
            .container(server, &format!("/library/sections/{section}/all"), &query)
            .await?;
        if filters.needs_whole_library(sort) {
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
            .container(server, &format!("/library/metadata/{rating_key}"), &[("includeMarkers", "1"), ("includeChapters", "1"), ("includeGuids", "1")])
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

    /// The episode a Play button on a show or season page should start.
    pub async fn up_next(&self, server: &ServerConnection, item: &Metadata) -> Result<Option<Metadata>> {
        let path = match item.kind.as_str() {
            "show" => format!("/library/metadata/{}/allLeaves", item.rating_key),
            "season" => format!("/library/metadata/{}/children", item.rating_key),
            _ => return Ok(None),
        };
        Ok(up_next(self.container(server, &path, &[]).await?.metadata))
    }

    pub async fn search(&self, server: &ServerConnection, query: &str) -> Result<Vec<Hub>> {
        let c = self
            .container(server, "/hubs/search", &[("query", query), ("limit", "12")])
            .await?;
        Ok(c.hub.into_iter().filter(|h| !h.metadata.is_empty()).collect())
    }
}

/// Takes out of On Deck whatever Continue Watching already shows: the same
/// item, or another episode of a show being watched part way through.
fn drop_on_deck_duplicates(hubs: &mut [Hub]) {
    let id = |h: &Hub| h.hub_identifier.to_ascii_lowercase();
    let Some(continuing) = hubs.iter().find(|h| id(h).contains("continue")) else {
        return;
    };
    let keys: HashSet<String> = continuing
        .metadata
        .iter()
        .flat_map(|m| [Some(m.rating_key.clone()), m.grandparent_rating_key.clone()])
        .flatten()
        .collect();
    for hub in hubs.iter_mut().filter(|h| id(h).contains("ondeck")) {
        hub.metadata.retain(|m| {
            !keys.contains(&m.rating_key) && !m.grandparent_rating_key.as_ref().is_some_and(|g| keys.contains(g))
        });
    }
}

/// The episode to play next in a show or season, Plex's "on deck": one
/// that is part way through, else the one after the last watched, else the
/// first. `None` once everything has been watched.
fn up_next(mut episodes: Vec<Metadata>) -> Option<Metadata> {
    let specials = episodes.iter().all(|m| m.parent_index == Some(0));
    episodes.retain(|m| specials || m.parent_index != Some(0));
    episodes.sort_by_key(|m| (m.parent_index, m.index));
    let watched = |m: &Metadata| m.view_count.unwrap_or_default() > 0;
    let started = |m: &Metadata| m.view_offset.unwrap_or_default() > 0;
    let last = episodes.iter().rposition(|m| watched(m) || started(m));
    match last {
        Some(i) if started(&episodes[i]) => episodes.into_iter().nth(i),
        Some(i) => episodes.into_iter().skip(i + 1).find(|m| !watched(m)),
        None => episodes.into_iter().next(),
    }
}

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
    fn up_next_follows_the_last_watched_episode() {
        let ep = |key: &str, season, index, views, offset| Metadata {
            rating_key: key.into(),
            parent_index: Some(season),
            index: Some(index),
            view_count: Some(views),
            view_offset: Some(offset),
            ..Default::default()
        };
        let next = |eps: Vec<Metadata>| up_next(eps).map(|m| m.rating_key);

        // Nothing watched: the first episode, specials skipped.
        assert_eq!(next(vec![ep("b", 1, 2, 0, 0), ep("x", 0, 1, 0, 0), ep("a", 1, 1, 0, 0)]).as_deref(), Some("a"));
        // Part way through one: that one.
        assert_eq!(next(vec![ep("a", 1, 1, 1, 0), ep("b", 1, 2, 0, 500), ep("c", 1, 3, 0, 0)]).as_deref(), Some("b"));
        // After the last watched, across seasons.
        assert_eq!(next(vec![ep("a", 1, 1, 1, 0), ep("b", 1, 2, 1, 0), ep("c", 2, 1, 0, 0)]).as_deref(), Some("c"));
        // Everything watched.
        assert_eq!(next(vec![ep("a", 1, 1, 1, 0)]), None);
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

    #[test]
    fn on_deck_skips_what_continue_watching_shows() {
        let item = |key: &str, show: Option<&str>| Metadata {
            rating_key: key.into(),
            grandparent_rating_key: show.map(Into::into),
            ..Default::default()
        };
        let hub = |id: &str, items: Vec<Metadata>| Hub { hub_identifier: id.into(), metadata: items, ..Default::default() };
        let mut hubs = vec![
            hub("home.continue", vec![item("movie1", None), item("s1e3", Some("show1"))]),
            hub(
                "home.ondeck",
                vec![item("movie1", None), item("s1e4", Some("show1")), item("s2e1", Some("show2")), item("movie2", None)],
            ),
            hub("home.movies.recent", vec![item("movie1", None)]),
        ];
        drop_on_deck_duplicates(&mut hubs);
        let keys = |h: &Hub| h.metadata.iter().map(|m| m.rating_key.clone()).collect::<Vec<_>>();
        assert_eq!(keys(&hubs[1]), ["s2e1", "movie2"]);
        // Other rows are left alone.
        assert_eq!(keys(&hubs[2]), ["movie1"]);
    }

    #[test]
    fn random_order_and_bitrate_fetch_the_whole_library() {
        let f = Filters::default();
        assert!(f.needs_whole_library("random"));
        assert!(!f.needs_whole_library("addedAt:desc"));
        let f = Filters { min_bitrate_kbps: Some(1), ..Default::default() };
        assert!(f.needs_whole_library("titleSort"));
    }

    #[test]
    fn parses_info_fields() {
        let json = r#"{"MediaContainer":{"Metadata":[{"ratingKey":"9","type":"movie","title":"Collateral",
            "originalTitle":"Kollateral","editionTitle":"Director's Cut","userRating":8.0,"lastViewedAt":1700000000,
            "Guid":[{"id":"imdb://tt0369339"}],"Writer":[{"tag":"Stuart Beattie"}],"Country":[{"tag":"USA"}],
            "Media":[{"width":3840,"height":1608,"aspectRatio":2.35,"videoFrameRate":"24p","Part":[{"duration":7200000,"Stream":[
                {"streamType":1,"codec":"hevc","bitDepth":10,"frameRate":23.976,"colorPrimaries":"bt2020","colorTrc":"smpte2084"},
                {"streamType":2,"codec":"truehd","channels":8,"audioChannelLayout":"7.1","samplingRate":48000,"default":true}]}]}]}]}}"#;
        let body: Body = serde_json::from_str(json).unwrap();
        let m = &body.container.metadata[0];
        assert_eq!(m.guids[0].id, "imdb://tt0369339");
        assert_eq!(m.writer[0].tag, "Stuart Beattie");
        assert_eq!(m.media[0].height, Some(1608));
        let streams = &m.media[0].part[0].stream;
        assert_eq!(streams[0].bit_depth, Some(10));
        assert_eq!(streams[0].color_trc.as_deref(), Some("smpte2084"));
        assert_eq!(streams[1].channels, Some(8));
    }

    #[test]
    fn parses_playlist() {
        let json = r#"{"MediaContainer":{"size":1,"Metadata":[{"ratingKey":"55","key":"/playlists/55/items",
            "type":"playlist","title":"Marvel order","playlistType":"video","smart":false,"leafCount":12,
            "composite":"/playlists/55/composite/1700000000","duration":86400000}]}}"#;
        let body: Body = serde_json::from_str(json).unwrap();
        let p = &body.container.metadata[0];
        assert_eq!(p.kind, "playlist");
        assert_eq!(p.leaf_count, Some(12));
        assert_eq!(p.composite.as_deref(), Some("/playlists/55/composite/1700000000"));
    }
}
