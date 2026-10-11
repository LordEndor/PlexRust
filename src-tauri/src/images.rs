//! `plximg://` serves Plex artwork to the UI. The webview never talks to the
//! Plex server itself: Rust fetches each image (over the same connection the
//! API uses, with the token kept out of the page) and keeps recent ones in
//! memory so scrolling back is instant.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager, UriSchemeResponder};

use crate::AppState;

const CACHE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Default)]
pub struct ImageCache {
    inner: Mutex<CacheInner>,
}

#[derive(Default)]
struct CacheInner {
    map: HashMap<String, Arc<(Vec<u8>, String)>>,
    order: VecDeque<String>,
    bytes: usize,
}

impl ImageCache {
    fn get(&self, key: &str) -> Option<Arc<(Vec<u8>, String)>> {
        self.inner.lock().ok()?.map.get(key).cloned()
    }

    fn put(&self, key: String, value: Arc<(Vec<u8>, String)>) {
        let Ok(mut c) = self.inner.lock() else { return };
        if c.map.contains_key(&key) {
            return;
        }
        c.bytes += value.0.len();
        c.order.push_back(key.clone());
        c.map.insert(key, value);
        while c.bytes > CACHE_BYTES {
            let Some(old) = c.order.pop_front() else { break };
            if let Some(v) = c.map.remove(&old) {
                c.bytes -= v.0.len();
            }
        }
    }
}

pub fn handle(app: &AppHandle, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = app.clone();
    let query = request.uri().query().unwrap_or_default().to_owned();
    tauri::async_runtime::spawn(async move {
        responder.respond(match serve(&app, &query).await {
            Ok((bytes, kind)) => Response::builder()
                .header(header::CONTENT_TYPE, kind)
                .header(header::CACHE_CONTROL, "public, max-age=604800, immutable")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(bytes)
                .unwrap(),
            Err(e) => Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(e.into_bytes())
                .unwrap(),
        });
    });
}

async fn serve(app: &AppHandle, query: &str) -> Result<(Vec<u8>, String), String> {
    let mut path = None;
    let (mut w, mut h) = (300, 450);
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        match &*k {
            "url" => path = Some(v.into_owned()),
            "w" => w = v.parse().unwrap_or(w).clamp(16, 3840),
            "h" => h = v.parse().unwrap_or(h).clamp(16, 2160),
            _ => {}
        }
    }
    let path = path.ok_or("missing url")?;
    // The query also carries the server id, so switching servers never
    // serves another server's artwork.
    let key = query.to_owned();

    let cache = app.state::<ImageCache>();
    if let Some(hit) = cache.get(&key) {
        return Ok((hit.0.clone(), hit.1.clone()));
    }

    let state = app.state::<AppState>();
    let server = state.settings.lock().await.server.clone().ok_or("no server")?;
    let (bytes, kind) = state
        .plex
        .image(&server, &path, w, h)
        .await
        .map_err(|e| e.to_string())?;
    cache.put(key, Arc::new((bytes.clone(), kind.clone())));
    Ok((bytes, kind))
}
