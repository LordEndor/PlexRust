use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::client::{PLEX_TV, PlexClient};
use crate::error::{Error, Result, check};

/// A plex.tv sign-in PIN. The user confirms it in the browser at
/// [`PlexClient::auth_url`], after which polling it yields a token.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub id: u64,
    pub code: String,
    #[serde(default)]
    pub auth_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: u64,
    pub uuid: String,
    pub username: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub thumb: Option<String>,
}

impl PlexClient {
    pub async fn create_pin(&self) -> Result<Pin> {
        let resp = self
            .http
            .post(format!("{PLEX_TV}/api/v2/pins"))
            .query(&[("strong", "true")])
            .send()
            .await?;
        Ok(check(resp).await?.json().await?)
    }

    pub async fn check_pin(&self, id: u64) -> Result<Pin> {
        let resp = self
            .http
            .get(format!("{PLEX_TV}/api/v2/pins/{id}"))
            .send()
            .await?;
        Ok(check(resp).await?.json().await?)
    }

    /// The page where the user approves `pin` with their Plex account.
    pub fn auth_url(&self, pin: &Pin) -> String {
        let q = [
            ("clientID", self.info.client_id.as_str()),
            ("code", pin.code.as_str()),
            ("context[device][product]", self.info.product.as_str()),
        ];
        let query = q
            .iter()
            .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
            .collect::<Vec<_>>()
            .join("&");
        format!("https://app.plex.tv/auth#?{query}")
    }

    /// Polls `pin` once a second until the user approves it, giving up after
    /// `timeout`.
    pub async fn wait_for_token(&self, pin: &Pin, timeout: Duration) -> Result<String> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if let Some(token) = self.check_pin(pin.id).await?.auth_token.filter(|t| !t.is_empty()) {
                return Ok(token);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(Error::PinExpired);
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    pub async fn user(&self, token: &str) -> Result<User> {
        let resp = self
            .http
            .get(format!("{PLEX_TV}/api/v2/user"))
            .header("X-Plex-Token", token)
            .send()
            .await?;
        Ok(check(resp).await?.json().await?)
    }
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientInfo;

    #[test]
    fn auth_url_encodes_params() {
        let client = PlexClient::new(ClientInfo {
            client_id: "abc-123".into(),
            product: "Plex Rust".into(),
            version: "0.1.0".into(),
            platform: "Windows".into(),
            device_name: "pc".into(),
        })
        .unwrap();
        let pin = Pin { id: 1, code: "XYZ".into(), auth_token: None };
        assert_eq!(
            client.auth_url(&pin),
            "https://app.plex.tv/auth#?clientID=abc-123&code=XYZ&context%5Bdevice%5D%5Bproduct%5D=Plex%20Rust"
        );
    }

    #[test]
    fn pin_parses_null_token() {
        let pin: Pin = serde_json::from_str(r#"{"id":5,"code":"c","authToken":null,"expiresIn":900}"#).unwrap();
        assert_eq!(pin.auth_token, None);
    }
}
