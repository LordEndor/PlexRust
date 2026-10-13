//! Talks to a tiny fake Radarr and Sonarr to check the API key header and
//! how calendar entries are turned into releases.

use arr::{ArrClient, Error, Kind, MovieRelease, ReleaseKind};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const RADARR_CALENDAR: &str = r#"[
  {"id":7,"title":"Dune: Part Three","year":2026,"studio":"Legendary","runtime":0,"hasFile":false,"monitored":true,
   "inCinemas":"2026-09-18T00:00:00Z","digitalRelease":"2026-10-20T00:00:00Z","physicalRelease":"2026-11-30T00:00:00Z",
   "tmdbId":1170608,"images":[{"coverType":"poster","url":"/MediaCover/7/poster.jpg","remoteUrl":"https://image.tmdb.org/t/p/original/p.jpg"}]}
]"#;

const SONARR_CALENDAR: &str = r#"[
  {"id":501,"seriesId":3,"seasonNumber":2,"episodeNumber":1,"title":"TBA","airDate":"2026-10-14","airDateUtc":"2026-10-15T01:00:00Z",
   "hasFile":true,"monitored":true,"runtime":0,
   "series":{"title":"Severance","year":2022,"network":"Apple TV+","runtime":55,"tvdbId":371980,
     "images":[{"coverType":"poster","url":"/MediaCover/3/poster.jpg","remoteUrl":"https://artworks.thetvdb.com/p.jpg"},
               {"coverType":"fanart","url":"/MediaCover/3/fanart.jpg"}]}}
]"#;

const SONARR_QUEUE: &str = r#"{"page":1,"totalRecords":2,"records":[
  {"id":1,"downloadId":"ABCDEF","title":"Severance.S02.1080p","seasonNumber":2,"trackedDownloadState":"downloading",
   "series":{"title":"Severance","year":2022,"tvdbId":371980,"tmdbId":95396,"images":[{"coverType":"poster","remoteUrl":"https://artworks.thetvdb.com/p.jpg"}]},
   "episode":{"seasonNumber":2,"episodeNumber":5,"title":"Trojan's Horse"}},
  {"id":2,"title":"Nothing to match","trackedDownloadState":"downloading"}
]}"#;

async fn serve(app: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                while !String::from_utf8_lossy(&buf).contains("\r\n\r\n") {
                    let n = sock.read(&mut chunk).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let req = String::from_utf8_lossy(&buf).to_string();
                let line = req.lines().next().unwrap_or_default().to_owned();
                let (status, body) = if !req.to_ascii_lowercase().contains("x-api-key: secret\r\n") {
                    ("401 Unauthorized", String::new())
                } else if line.starts_with("GET /base/api/v3/system/status ") {
                    ("200 OK", format!(r#"{{"appName":"{app}","version":"5.1.0"}}"#))
                } else if line.starts_with("GET /base/api/v3/calendar?start=2026-10-01&end=2026-10-31&unmonitored=false")
                {
                    let body = if app == "Radarr" { RADARR_CALENDAR } else { SONARR_CALENDAR };
                    assert_eq!(app == "Sonarr", line.contains("includeSeries=true"), "{line}");
                    ("200 OK", body.to_owned())
                } else if line.starts_with("GET /base/api/v3/queue?pageSize=1000&includeSeries=true&includeEpisode=true ") {
                    ("200 OK", SONARR_QUEUE.to_owned())
                } else {
                    ("404 Not Found", format!(r#"{{"message":"{line}"}}"#))
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                sock.write_all(resp.as_bytes()).await.unwrap();
            });
        }
    });
    format!("http://{addr}/base/")
}

#[tokio::test]
async fn keeps_only_movie_dates_inside_the_range() {
    let url = serve("Radarr").await;
    let client = ArrClient::new(Kind::Radarr, &url, "secret").unwrap();
    assert_eq!(client.status().await.unwrap().version, "5.1.0");

    let releases = client.calendar("2026-10-01", "2026-10-31").await.unwrap();
    assert_eq!(releases.len(), 1, "{releases:?}");
    let r = &releases[0];
    assert_eq!(r.kind, ReleaseKind::Movie);
    assert_eq!(r.movie_release, Some(MovieRelease::Digital));
    assert_eq!(r.date, "2026-10-20");
    assert_eq!(r.id, "radarr-7-digital");
    assert_eq!(r.runtime, None);
    assert_eq!(r.poster.as_deref(), Some("https://image.tmdb.org/t/p/original/p.jpg"));
}

#[tokio::test]
async fn reads_episodes_with_their_show() {
    let url = serve("Sonarr").await;
    let client = ArrClient::new(Kind::Sonarr, &url, "secret").unwrap();
    let releases = client.calendar("2026-10-01", "2026-10-31").await.unwrap();
    let r = &releases[0];
    assert_eq!(r.kind, ReleaseKind::Episode);
    assert_eq!(r.title, "Severance");
    assert_eq!((r.season_number, r.episode_number), (Some(2), Some(1)));
    assert_eq!(r.episode_title, None, "TBA is a placeholder");
    assert_eq!(r.date, "2026-10-14");
    assert_eq!(r.air_date_utc.as_deref(), Some("2026-10-15T01:00:00Z"));
    assert_eq!(r.runtime, Some(55));
    assert!(r.has_file);
    assert_eq!(r.fanart, None, "local covers need the API key");
}

#[tokio::test]
async fn explains_bad_keys_and_swapped_servers() {
    let url = serve("Sonarr").await;
    let wrong_key = ArrClient::new(Kind::Sonarr, &url, "nope").unwrap();
    assert!(matches!(wrong_key.status().await, Err(Error::BadKey(Kind::Sonarr))));

    let swapped = ArrClient::new(Kind::Radarr, &url, "secret").unwrap();
    let err = swapped.status().await.unwrap_err();
    assert!(matches!(err, Error::WrongApp { .. }));
    assert_eq!(err.to_string(), "that address is Sonarr, not Radarr");
}

#[tokio::test]
async fn reads_the_queue_by_download_hash() {
    let url = serve("Sonarr").await;
    let client = ArrClient::new(Kind::Sonarr, &url, "secret").unwrap();
    let queue = client.queue().await.unwrap();
    assert_eq!(queue.len(), 1, "records without a download id are skipped");
    let q = &queue[0];
    assert_eq!(q.download_id, "abcdef");
    assert_eq!((q.season_number, q.episode_number), (Some(2), Some(5)));
    assert_eq!(q.episode_title.as_deref(), Some("Trojan's Horse"));
    assert_eq!(q.tmdb_id, Some(95396));
    assert_eq!(q.state.as_deref(), Some("downloading"));
}
