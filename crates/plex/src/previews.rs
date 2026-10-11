//! Seek-bar thumbnails. Plex stores them per file as a BIF ("base index
//! frames", Roku's format): a small header, a table of timestamps and
//! offsets, then the JPEG frames back to back.

use crate::client::PlexClient;
use crate::error::{Error, Result, check};
use crate::server::ServerConnection;

const MAGIC: [u8; 8] = [0x89, b'B', b'I', b'F', 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_LEN: usize = 64;

/// A parsed BIF file: frame `i` covers the time from `i * interval_ms`.
#[derive(Debug)]
pub struct PreviewIndex {
    pub interval_ms: u32,
    data: Vec<u8>,
    /// Byte range of each frame inside `data`.
    frames: Vec<(usize, usize)>,
}

impl PreviewIndex {
    pub fn parse(data: Vec<u8>) -> Option<Self> {
        if data.len() < HEADER_LEN || data[..8] != MAGIC {
            return None;
        }
        let u32_at = |at: usize| -> Option<u32> { Some(u32::from_le_bytes(data.get(at..at + 4)?.try_into().ok()?)) };
        let count = u32_at(12)? as usize;
        let interval_ms = match u32_at(16)? {
            0 => 1000,
            n => n,
        };
        // count + 1 entries of (timestamp, offset); the last one marks the end.
        let mut offsets = Vec::with_capacity(count + 1);
        for i in 0..=count {
            offsets.push(u32_at(HEADER_LEN + i * 8 + 4)? as usize);
        }
        let frames: Vec<_> = offsets
            .windows(2)
            .map(|w| (w[0], w[1]))
            .filter(|&(start, end)| start < end && end <= data.len())
            .collect();
        (frames.len() == count).then_some(Self { interval_ms, data, frames })
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// The JPEG for frame `i`.
    pub fn frame(&self, i: usize) -> Option<&[u8]> {
        let &(start, end) = self.frames.get(i)?;
        Some(&self.data[start..end])
    }
}

impl PlexClient {
    /// Downloads the thumbnail index for a media part. `None` when the server
    /// hasn't generated one (Plex's "video preview thumbnails" setting).
    pub async fn preview_index(&self, server: &ServerConnection, part_id: u64) -> Result<Option<PreviewIndex>> {
        let resp = self
            .http
            .get(format!("{}/library/parts/{part_id}/indexes/sd", server.uri))
            .header("X-Plex-Token", &server.token)
            .header("Accept", "*/*")
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let bytes = check(resp).await?.bytes().await.map_err(Error::Http)?;
        Ok(PreviewIndex::parse(bytes.to_vec()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bif(frames: &[&[u8]], interval: u32) -> Vec<u8> {
        let mut out = MAGIC.to_vec();
        out.extend(0u32.to_le_bytes());
        out.extend((frames.len() as u32).to_le_bytes());
        out.extend(interval.to_le_bytes());
        out.resize(HEADER_LEN, 0);
        let mut offset = HEADER_LEN + (frames.len() + 1) * 8;
        for (i, f) in frames.iter().enumerate() {
            out.extend((i as u32).to_le_bytes());
            out.extend((offset as u32).to_le_bytes());
            offset += f.len();
        }
        out.extend(u32::MAX.to_le_bytes());
        out.extend((offset as u32).to_le_bytes());
        for f in frames {
            out.extend_from_slice(f);
        }
        out
    }

    #[test]
    fn parses_frames() {
        let index = PreviewIndex::parse(bif(&[b"one", b"second", b"3"], 2000)).unwrap();
        assert_eq!(index.interval_ms, 2000);
        assert_eq!(index.len(), 3);
        assert_eq!(index.frame(1), Some(&b"second"[..]));
        assert_eq!(index.frame(3), None);
    }

    #[test]
    fn zero_interval_means_one_second() {
        assert_eq!(PreviewIndex::parse(bif(&[b"x"], 0)).unwrap().interval_ms, 1000);
    }

    #[test]
    fn rejects_garbage() {
        assert!(PreviewIndex::parse(b"not a bif file at all, just text that is long enough to pass".repeat(2)).is_none());
        let mut truncated = bif(&[b"one", b"two"], 1000);
        truncated.truncate(truncated.len() - 2);
        assert!(PreviewIndex::parse(truncated).is_none());
    }
}
