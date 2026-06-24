//! Core-management domain (W5). Pure, testable building blocks for installing,
//! updating, and activating libretro cores from the libretro buildbot. One file
//! per concern so the pieces compose without entangling:
//!
//!   - [`system_map`] — curated system → buildbot-core-id map (named constants).
//!   - [`arch`]       — Mach-O / arm64 verification of a downloaded dylib.
//!   - [`buildbot`]   — buildbot URL building + (network) download/HEAD client.
//!   - [`install`]    — orchestration: download, unzip, arch-verify, place on
//!     disk, persist via the W3 cores repo.
//!
//! The `commands/cores.rs` adapter is the only Tauri-aware layer; everything
//! here returns [`AppResult`](crate::error::AppResult) and avoids Tauri types so
//! it is unit-testable without a running app.

pub mod arch;
pub mod buildbot;
pub mod install;
pub mod system_map;
