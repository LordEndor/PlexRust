#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Plex rejected the request ({status}): {body}")]
    Status {
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("sign-in PIN expired before it was confirmed")]
    PinExpired,
    #[error("none of the server's connections responded")]
    Unreachable,
}

pub type Result<T> = std::result::Result<T, Error>;

/// Turns a non-2xx response into [`Error::Status`] with the body for context.
pub(crate) async fn check(resp: reqwest::Response) -> Result<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    Err(Error::Status { status, body })
}
