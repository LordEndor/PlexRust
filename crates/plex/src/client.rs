use std::time::Duration;

use reqwest::header::{ACCEPT, HeaderMap, HeaderName, HeaderValue};

/// How this app identifies itself to Plex. `client_id` must stay stable per
/// install, otherwise every launch shows up as a new device in the account.
#[derive(Debug, Clone)]
pub struct ClientInfo {
    pub client_id: String,
    pub product: String,
    pub version: String,
    pub platform: String,
    pub device_name: String,
}

impl ClientInfo {
    pub(crate) fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(ACCEPT, HeaderValue::from_static("application/json"));
        let mut put = |name: &'static str, value: &str| {
            if let Ok(v) = HeaderValue::from_str(value) {
                h.insert(HeaderName::from_static(name), v);
            }
        };
        put("x-plex-client-identifier", &self.client_id);
        put("x-plex-product", &self.product);
        put("x-plex-version", &self.version);
        put("x-plex-platform", &self.platform);
        put("x-plex-device", &self.platform);
        put("x-plex-device-name", &self.device_name);
        h
    }
}

/// Entry point for talking to plex.tv. Cheap to clone.
#[derive(Debug, Clone)]
pub struct PlexClient {
    pub(crate) http: reqwest::Client,
    pub(crate) info: ClientInfo,
}

pub(crate) const PLEX_TV: &str = "https://plex.tv";
pub(crate) const CLIENTS_PLEX_TV: &str = "https://clients.plex.tv";

impl PlexClient {
    pub fn new(info: ClientInfo) -> crate::Result<Self> {
        let http = reqwest::Client::builder()
            .default_headers(info.headers())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()?;
        Ok(Self { http, info })
    }

    pub fn info(&self) -> &ClientInfo {
        &self.info
    }
}
