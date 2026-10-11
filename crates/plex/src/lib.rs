//! Async client for plex.tv (account, PIN sign-in, server discovery) and
//! Plex Media Server.

mod auth;
mod client;
mod error;
mod library;
mod resources;
mod server;

pub use auth::{Pin, User};
pub use client::{ClientInfo, PlexClient};
pub use error::{Error, Result};
pub use library::{Hub, Media, Metadata, Page, Tag};
pub use resources::{Connection, Resource};
pub use server::{LibrarySection, ServerConnection};
