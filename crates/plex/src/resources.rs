use serde::{Deserialize, Serialize};

use crate::client::{CLIENTS_PLEX_TV, PlexClient};
use crate::error::{Result, check};

/// A device on the account, as listed by plex.tv. Servers have `"server"` in
/// `provides`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub name: String,
    pub client_identifier: String,
    #[serde(default)]
    pub product: String,
    #[serde(default)]
    pub product_version: String,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub provides: String,
    #[serde(default)]
    pub owned: bool,
    #[serde(default)]
    pub presence: bool,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub connections: Vec<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub uri: String,
    #[serde(default)]
    pub local: bool,
    #[serde(default)]
    pub relay: bool,
    #[serde(default, rename = "IPv6")]
    pub ipv6: bool,
}

impl Resource {
    pub fn is_server(&self) -> bool {
        self.provides.split(',').any(|p| p == "server")
    }
}

impl PlexClient {
    /// Every Plex Media Server the account can reach, owned or shared.
    pub async fn servers(&self, token: &str) -> Result<Vec<Resource>> {
        let resp = self
            .http
            .get(format!("{CLIENTS_PLEX_TV}/api/v2/resources"))
            .query(&[("includeHttps", "1"), ("includeRelay", "1"), ("includeIPv6", "1")])
            .header("X-Plex-Token", token)
            .send()
            .await?;
        let all: Vec<Resource> = check(resp).await?.json().await?;
        Ok(all.into_iter().filter(Resource::is_server).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_resources_and_filters_servers() {
        let json = r#"[
          {"name":"Home","clientIdentifier":"s1","provides":"server","owned":true,"accessToken":"t",
           "connections":[{"protocol":"https","address":"192.168.1.2","port":32400,
             "uri":"https://192-168-1-2.abc.plex.direct:32400","local":true,"relay":false,"IPv6":false}]},
          {"name":"Phone","clientIdentifier":"p1","provides":"client,player","connections":[]}
        ]"#;
        let all: Vec<Resource> = serde_json::from_str(json).unwrap();
        let servers: Vec<_> = all.into_iter().filter(Resource::is_server).collect();
        assert_eq!(servers.len(), 1);
        assert!(servers[0].connections[0].local);
    }
}
