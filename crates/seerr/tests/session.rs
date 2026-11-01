//! Talks to a tiny fake Seerr to check the Plex sign-in and the automatic
//! second sign-in when the session cookie stops working.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use seerr::{Auth, Error, SeerrClient};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct Fake {
    sign_ins: AtomicUsize,
    /// Requests to reject with 401 before accepting the cookie.
    reject: AtomicUsize,
}

async fn serve(fake: Arc<Fake>) -> String {
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
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf);
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text[..end]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                            .unwrap_or(0);
                        if buf.len() >= end + 4 + len || n == 0 {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let req = String::from_utf8_lossy(&buf).to_string();
                let line = req.lines().next().unwrap_or_default().to_owned();
                let cookie = req.lines().find(|l| l.to_ascii_lowercase().starts_with("cookie:")).unwrap_or_default().to_owned();
                let (status, extra, body) = if line.starts_with("POST /api/v1/auth/plex") {
                    assert!(req.contains(r#""authToken":"plex-token""#), "{req}");
                    let n = fake.sign_ins.fetch_add(1, Ordering::SeqCst) + 1;
                    ("200 OK", format!("Set-Cookie: connect.sid=s{n}; Path=/\r\n"), r#"{"id":1}"#.to_owned())
                } else if !cookie.contains("connect.sid=") {
                    ("403 Forbidden", String::new(), r#"{"message":"no cookie"}"#.to_owned())
                } else if fake.reject.load(Ordering::SeqCst) > 0 {
                    fake.reject.fetch_sub(1, Ordering::SeqCst);
                    ("401 Unauthorized", String::new(), r#"{"message":"expired"}"#.to_owned())
                } else if line.starts_with("GET /api/v1/search?query=The%20Office%20%28US%29&page=1 ") {
                    ("200 OK", String::new(), r#"{"results":[{"id":2316}]}"#.to_owned())
                } else {
                    ("404 Not Found", String::new(), format!(r#"{{"message":"{line}"}}"#))
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
                    body.len()
                );
                sock.write_all(resp.as_bytes()).await.unwrap();
            });
        }
    });
    format!("{addr}")
}

#[tokio::test]
async fn signs_in_with_plex_and_again_when_the_session_expires() {
    let fake = Arc::new(Fake { sign_ins: AtomicUsize::new(0), reject: AtomicUsize::new(0) });
    let addr = serve(fake.clone()).await;
    let client = SeerrClient::new(&addr, Auth::Plex("plex-token".into())).unwrap();

    let found = client.search("The Office (US)", 1).await.unwrap();
    assert_eq!(found["results"][0]["id"], 2316);
    assert_eq!(fake.sign_ins.load(Ordering::SeqCst), 1);

    fake.reject.store(1, Ordering::SeqCst);
    let found = client.search("The Office (US)", 1).await.unwrap();
    assert_eq!(found["results"][0]["id"], 2316);
    assert_eq!(fake.sign_ins.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn reports_seerr_error_messages() {
    let fake = Arc::new(Fake { sign_ins: AtomicUsize::new(0), reject: AtomicUsize::new(0) });
    let addr = serve(fake).await;
    let client = SeerrClient::new(&addr, Auth::Plex("plex-token".into())).unwrap();
    match client.search("nothing", 1).await {
        Err(Error::Status { status, message }) => {
            assert_eq!(status.as_u16(), 404);
            assert!(message.contains("/api/v1/search?query=nothing"), "{message}");
        }
        other => panic!("expected a 404, got {other:?}"),
    }
}
