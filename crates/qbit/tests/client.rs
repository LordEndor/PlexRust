//! Talks to a tiny fake qBittorrent to check signing in, the session cookie,
//! signing in again when the session is gone, and the 4.x vs 5.x action names.

use std::sync::{Arc, Mutex};

use qbit::{Action, Error, QbitClient, State, Sync};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Default)]
struct Fake {
    /// Session ids handed out; only the last one is valid.
    logins: u32,
    /// Requests that reached an action, as `path?body`.
    actions: Vec<String>,
    /// Answer a wrong password with 401, as qBittorrent 5.2 does.
    unauthorized_on_bad_login: bool,
}

async fn serve(api: &'static str, fake: Arc<Mutex<Fake>>) -> String {
    serve_with(api, "SID", fake).await
}

/// `cookie` is the name qBittorrent gives the session cookie.
async fn serve_with(api: &'static str, cookie: &'static str, fake: Arc<Mutex<Fake>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let fake = fake.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let n = sock.read(&mut chunk).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text[..end]
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .map(|v| v.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if buf.len() >= end + 4 + len {
                            break;
                        }
                    }
                }
                let req = String::from_utf8_lossy(&buf).to_string();
                let (head, body) = req.split_once("\r\n\r\n").unwrap();
                let line = head.lines().next().unwrap_or_default().to_owned();
                let lower = head.to_ascii_lowercase();
                let path = line.split(' ').nth(1).unwrap_or_default().to_owned();
                let mut extra = String::new();
                let (status, reply) = {
                    let mut f = fake.lock().unwrap();
                    let valid =
                        format!("cookie: {}=s{}\r\n", cookie.to_ascii_lowercase(), f.logins);
                    if !lower.contains("referer: http://127.0.0.1") {
                        ("401 Unauthorized", String::new())
                    } else if path == "/qb/api/v2/auth/login" {
                        if body == "username=albin&password=p%26ss" {
                            f.logins += 1;
                            extra =
                                format!("Set-Cookie: {cookie}=s{}; HttpOnly; path=/\r\n", f.logins);
                            ("200 OK", "Ok.".to_owned())
                        } else if f.unauthorized_on_bad_login {
                            ("401 Unauthorized", "Unauthorized".to_owned())
                        } else {
                            ("200 OK", "Fails.".to_owned())
                        }
                    } else if f.logins == 0 || !lower.contains(&valid) {
                        ("403 Forbidden", "Forbidden".to_owned())
                    } else if path == "/qb/api/v2/app/version" {
                        ("200 OK", "v5.0.2".to_owned())
                    } else if path == "/qb/api/v2/app/webapiVersion" {
                        ("200 OK", api.to_owned())
                    } else if path == "/qb/api/v2/sync/maindata?rid=0" {
                        (
                            "200 OK",
                            r#"{"rid":1,"full_update":true,"torrents":{"ABC":{"name":"Severance.S02E05","state":"stalledDL","progress":0.4,"size":100,"added_on":5}},"server_state":{"dl_info_speed":7}}"#.to_owned(),
                        )
                    } else if path == "/qb/api/v2/sync/maindata?rid=1" {
                        (
                            "200 OK",
                            r#"{"rid":2,"torrents":{"ABC":{"state":"downloading"}}}"#.to_owned(),
                        )
                    } else if path.starts_with("/qb/api/v2/torrents/") {
                        f.actions.push(format!(
                            "{}?{body}",
                            path.trim_start_matches("/qb/api/v2/torrents/")
                        ));
                        // The session runs out after the first action.
                        f.logins += 1;
                        ("200 OK", String::new())
                    } else {
                        ("404 Not Found", String::new())
                    }
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\n{extra}Content-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                    reply.len()
                );
                sock.write_all(resp.as_bytes()).await.unwrap();
            });
        }
    });
    format!("http://{addr}/qb/")
}

#[tokio::test]
async fn signs_in_and_lists_torrents() {
    let fake = Arc::new(Mutex::new(Fake::default()));
    let url = serve("2.11.2", fake.clone()).await;
    let client = QbitClient::new(&url, "albin", "p&ss").unwrap();
    let v = client.version().await.unwrap();
    assert_eq!(v.app, "v5.0.2");

    let mut sync = Sync::default();
    client.sync(&mut sync).await.unwrap();
    assert_eq!(sync.snapshot().torrents[0].state, State::Stalled);
    client.sync(&mut sync).await.unwrap();
    let snap = sync.snapshot();
    assert_eq!(snap.torrents[0].hash, "abc");
    assert_eq!(snap.torrents[0].state, State::Downloading);
    assert_eq!(snap.transfer.dl_speed, 7);
}

#[tokio::test]
async fn uses_new_names_and_signs_in_again() {
    let fake = Arc::new(Mutex::new(Fake::default()));
    let url = serve("2.11.2", fake.clone()).await;
    let client = QbitClient::new(&url, "albin", "p&ss").unwrap();
    client
        .act(Action::Pause, &["abc".into(), "def".into()])
        .await
        .unwrap();
    // The fake dropped the session; this one has to sign in again.
    client
        .act(Action::DeleteWithFiles, &["abc".into()])
        .await
        .unwrap();
    let f = fake.lock().unwrap();
    assert_eq!(
        f.actions,
        [
            "stop?hashes=abc%7Cdef",
            "delete?hashes=abc&deleteFiles=true"
        ]
    );
}

#[tokio::test]
async fn uses_old_names_on_qbittorrent_4() {
    let fake = Arc::new(Mutex::new(Fake::default()));
    let url = serve("2.8.19", fake.clone()).await;
    let client = QbitClient::new(&url, "albin", "p&ss").unwrap();
    client.act(Action::Resume, &["abc".into()]).await.unwrap();
    assert_eq!(fake.lock().unwrap().actions, ["resume?hashes=abc"]);
}

#[tokio::test]
async fn wrong_password() {
    let url = serve("2.11.2", Arc::new(Mutex::new(Fake::default()))).await;
    let client = QbitClient::new(&url, "albin", "nope").unwrap();
    assert!(matches!(client.version().await, Err(Error::BadLogin)));
}

#[tokio::test]
async fn wrong_password_on_qbittorrent_5_2() {
    let fake = Arc::new(Mutex::new(Fake {
        unauthorized_on_bad_login: true,
        ..Fake::default()
    }));
    let url = serve("2.13.0", fake).await;
    let client = QbitClient::new(&url, "albin", "nope").unwrap();
    assert!(matches!(client.version().await, Err(Error::BadLogin)));
}

#[tokio::test]
async fn no_username_when_a_password_is_needed() {
    let url = serve("2.11.2", Arc::new(Mutex::new(Fake::default()))).await;
    let client = QbitClient::new(&url, "", "").unwrap();
    assert!(matches!(client.version().await, Err(Error::NeedsLogin)));
}

#[tokio::test]
async fn follows_the_port_named_cookie_of_qbittorrent_5_1() {
    let url = serve_with(
        "2.12.0",
        "QBT_SID_8888",
        Arc::new(Mutex::new(Fake::default())),
    )
    .await;
    let client = QbitClient::new(&url, "albin", "p&ss").unwrap();
    assert_eq!(client.version().await.unwrap().app, "v5.0.2");
}
