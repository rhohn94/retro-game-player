//! Metadata & art domain (W8).
//!
//! Provides: libretro-thumbnails CDN client, No-Intro name sanitizer, on-disk
//! art cache, and 3-tier fallback orchestration. Consumed by the thin Tauri
//! adapter in `commands/metadata.rs`.

pub mod art_cache;
pub mod cdn_client;
pub mod fallback;
pub mod name_sanitizer;
