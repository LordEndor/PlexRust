//! Async client for plex.tv (account, PIN sign-in, server discovery) and
//! Plex Media Server.

mod auth;
mod client;
mod error;
mod library;
mod playback;
mod previews;
mod resources;
mod server;
mod subtitles;
mod watchlist;

pub use auth::{Pin, User};
pub use client::{ClientInfo, PlexClient};
pub use error::{Error, Result};
pub use library::{Chapter, Directory, Filters, Guid, Hub, Marker, Media, Metadata, Page, Part, Stream, Tag};
pub use playback::TranscodeOptions;
pub use previews::PreviewIndex;
pub use resources::{Connection, Resource};
pub use server::{LibrarySection, ServerConnection};
pub use subtitles::SubtitleResult;
pub use watchlist::discover_id;
