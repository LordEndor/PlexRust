use reqwest::Url;

use crate::client::PlexClient;
use crate::error::{Result, check};
use crate::server::ServerConnection;

/// Settings for a server-side transcode, used when the original file is too
/// big for the connection.
#[derive(Debug, Clone)]
pub struct TranscodeOptions {
    pub max_bitrate_kbps: u32,
    /// e.g. `1920x1080`.
    pub resolution: String,
    /// Where to start, in seconds.
    pub offset_secs: f64,
    /// Identifies this playback so it can be stopped later.
    pub session: String,
}

impl PlexClient {
    /// URL that streams the original file, untouched. mpv plays anything, so
    /// this is the default.
    pub fn direct_url(&self, server: &ServerConnection, part_key: &str) -> String {
        let mut url = Url::parse(&format!("{}{part_key}", server.uri)).expect("server uri is a valid url");
        url.query_pairs_mut().append_pair("X-Plex-Token", &server.token);
        url.into()
    }

    /// HLS URL for the server to transcode `rating_key` down to `opts`.
    pub fn transcode_url(&self, server: &ServerConnection, rating_key: &str, opts: &TranscodeOptions) -> String {
        let mut url = Url::parse(&format!("{}/video/:/transcode/universal/start.m3u8", server.uri))
            .expect("server uri is a valid url");
        let location = if server.local { "lan" } else { "wan" };
        url.query_pairs_mut()
            .append_pair("path", &format!("/library/metadata/{rating_key}"))
            .append_pair("mediaIndex", "0")
            .append_pair("partIndex", "0")
            .append_pair("protocol", "hls")
            .append_pair("fastSeek", "1")
            .append_pair("directPlay", "0")
            .append_pair("directStream", "1")
            .append_pair("directStreamAudio", "1")
            .append_pair("hasMDE", "1")
            .append_pair("location", location)
            .append_pair("offset", &format!("{:.0}", opts.offset_secs.max(0.0)))
            .append_pair("videoQuality", "100")
            .append_pair("maxVideoBitrate", &opts.max_bitrate_kbps.to_string())
            .append_pair("videoResolution", &opts.resolution)
            .append_pair("session", &opts.session)
            .append_pair("X-Plex-Session-Identifier", &opts.session)
            .append_pair("X-Plex-Client-Identifier", &self.info.client_id)
            .append_pair("X-Plex-Product", &self.info.product)
            .append_pair("X-Plex-Version", &self.info.version)
            // The transcoder picks its output profile from the platform; the
            // generic browser profile gives plain H.264/AAC HLS.
            .append_pair("X-Plex-Platform", "Chrome")
            .append_pair("X-Plex-Device", "Windows")
            .append_pair("X-Plex-Token", &server.token);
        url.into()
    }

    pub async fn stop_transcode(&self, server: &ServerConnection, session: &str) -> Result<()> {
        let resp = self
            .http
            .get(format!("{}/video/:/transcode/universal/stop", server.uri))
            .query(&[("session", session)])
            .header("X-Plex-Token", &server.token)
            .send()
            .await?;
        check(resp).await?;
        Ok(())
    }

    /// Tells the server where playback is, so Continue Watching and other
    /// devices stay in sync. `state` is `playing`, `paused` or `stopped`.
    pub async fn timeline(
        &self,
        server: &ServerConnection,
        rating_key: &str,
        state: &str,
        time_ms: u64,
        duration_ms: u64,
    ) -> Result<()> {
        let (time, duration) = (time_ms.to_string(), duration_ms.to_string());
        let key = format!("/library/metadata/{rating_key}");
        let resp = self
            .http
            .get(format!("{}/:/timeline", server.uri))
            .query(&[
                ("ratingKey", rating_key),
                ("key", key.as_str()),
                ("state", state),
                ("time", &time),
                ("duration", &duration),
                ("hasMDE", "1"),
            ])
            .header("X-Plex-Token", &server.token)
            .send()
            .await?;
        check(resp).await?;
        Ok(())
    }

    /// Marks an item as watched.
    pub async fn scrobble(&self, server: &ServerConnection, rating_key: &str) -> Result<()> {
        let resp = self
            .http
            .get(format!("{}/:/scrobble", server.uri))
            .query(&[("key", rating_key), ("identifier", "com.plexapp.plugins.library")])
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
    use crate::ClientInfo;

    fn fixtures() -> (PlexClient, ServerConnection) {
        let client = PlexClient::new(ClientInfo {
            client_id: "cid".into(),
            product: "PlexRust".into(),
            version: "0.1.0".into(),
            platform: "Windows".into(),
            device_name: "pc".into(),
        })
        .unwrap();
        let server = ServerConnection {
            machine_id: "m".into(),
            name: "s".into(),
            uri: "https://10-0-0-2.abc.plex.direct:32400".into(),
            token: "tok".into(),
            local: true,
            relay: false,
        };
        (client, server)
    }

    #[test]
    fn direct_url_appends_token() {
        let (c, s) = fixtures();
        assert_eq!(
            c.direct_url(&s, "/library/parts/5/170/file.mkv"),
            "https://10-0-0-2.abc.plex.direct:32400/library/parts/5/170/file.mkv?X-Plex-Token=tok"
        );
    }

    #[test]
    fn transcode_url_has_required_params() {
        let (c, s) = fixtures();
        let url = c.transcode_url(
            &s,
            "42",
            &TranscodeOptions {
                max_bitrate_kbps: 8000,
                resolution: "1920x1080".into(),
                offset_secs: 61.4,
                session: "sess".into(),
            },
        );
        let parsed = Url::parse(&url).unwrap();
        let q: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(parsed.path(), "/video/:/transcode/universal/start.m3u8");
        assert_eq!(q["path"], "/library/metadata/42");
        assert_eq!(q["offset"], "61");
        assert_eq!(q["maxVideoBitrate"], "8000");
        assert_eq!(q["location"], "lan");
        assert_eq!(q["X-Plex-Token"], "tok");
    }
}
