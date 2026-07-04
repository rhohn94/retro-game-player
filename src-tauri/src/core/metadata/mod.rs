//! Metadata & art domain (W8; extended v0.31 W314 for non-retro sources).
//!
//! Provides: libretro-thumbnails CDN client, No-Intro name sanitizer, on-disk
//! art cache, and 3-tier fallback orchestration for ROM-sourced games; the
//! Steam public CDN client + orchestrator and `.app` bundle-icon fallback
//! for non-retro sources (`steam` / `app` / `manual`). Consumed by the thin
//! Tauri adapter in `commands/metadata.rs` and `commands/sources.rs`.

pub mod art_cache;
pub mod bundle_icon;
pub mod cdn_client;
pub mod fallback;
pub mod name_sanitizer;
pub mod steam_art;
pub mod steam_cdn;
pub mod wikipedia;
