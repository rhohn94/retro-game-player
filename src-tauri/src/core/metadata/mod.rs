//! Metadata & art domain (W8; extended v0.31 W314 for non-retro sources;
//! v0.32 W321 adds SteamGridDB + the unified fallback chain).
//!
//! Provides: libretro-thumbnails CDN client, No-Intro name sanitizer, on-disk
//! art cache, and 3-tier fallback orchestration for ROM-sourced games; the
//! Steam public CDN client + orchestrator, `.app` bundle-icon fallback, and
//! the keyed SteamGridDB client + orchestrator for non-retro sources
//! (`steam` / `app` / `manual` / `gog` / `itch`) — unified behind
//! [`art_fallback_chain::resolve_art`]. Consumed by the thin Tauri adapter in
//! `commands/metadata.rs` and `commands/sources.rs`.

pub mod art_cache;
pub mod art_fallback_chain;
pub mod bundle_icon;
pub mod cdn_client;
pub mod fallback;
pub mod name_sanitizer;
pub mod steam_art;
pub mod steam_cdn;
pub mod steamgriddb_art;
pub mod steamgriddb_client;
pub mod wikipedia;
