//! Core domain modules — pure business logic, no Tauri types.
//! Tauri command adapters in `commands/` call into these.

pub mod vibrancy; // W10 — pre-blur pipeline + disk cache
