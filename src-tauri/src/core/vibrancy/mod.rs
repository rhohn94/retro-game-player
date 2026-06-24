//! Vibrancy core domain (W10) — pre-blur pipeline and disk cache.
//!
//! Public surface used by the `commands/vibrancy.rs` Tauri adapter:
//! `blur_cache::get_or_compute` is the single entry point; `blur_pipeline` is
//! exposed so it can be independently unit-tested.

pub mod blur_cache;
pub mod blur_pipeline;
