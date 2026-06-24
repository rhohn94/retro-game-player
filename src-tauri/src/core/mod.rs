//! Domain logic — pure, Tauri-free, unit-testable.
//!
//! One sub-module per feature domain (W5–W15). Thin `#[tauri::command]`
//! adapters in `commands/` call into these modules and map results to
//! [`crate::error::AppResult`]. Master contract architecture-design.md §1.2.
//!
//! APPEND-ONLY: each domain item adds exactly one `pub mod <domain>;` line.

pub mod metadata; // W8 — CDN client, name sanitizer, art cache, fallback
