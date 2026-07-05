//! Game-source scanner abstraction (v0.31 "Frontier" — see
//! `docs/design/non-retro-library-design.md` §Game sources).
//!
//! A `GameSourceScanner` discovers candidate library entries from some
//! external inventory (a storefront's install manifests, `/Applications`,
//! a manual form) without touching the database itself — the IPC command
//! layer maps a scanner's [`DiscoveredGame`]s onto
//! `LibraryRepo::upsert_game_by_source`. Keep this file minimal: each
//! scanner implementation lives in its own module (e.g. `steam.rs`).

use crate::db::repo::library::GameSource;
use crate::error::AppResult;
use serde_json::Value;

pub mod app_scan; // W313 — /Applications + ~/Applications game-category scan
pub mod gog; // W320 — GOG Galaxy manifest + install-root scan
pub mod itch; // W320 — itch receipt + install-dir scan
pub mod rom; // W322 — legacy ROM folder scanner migrated onto GameSource
pub mod steam; // W312 — Steam appmanifest scan

/// One game discovered by a [`GameSourceScanner`], not yet persisted.
///
/// Mirrors the fields a `NewGame` non-ROM row needs (source, external id,
/// launch descriptor); the IPC layer is responsible for turning this into a
/// `NewGame` and calling `upsert_game_by_source`. Serializes so confirm-gated
/// shortlists (W313 app scan) can cross the IPC boundary as-is.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct DiscoveredGame {
    /// Display name as reported by the source (e.g. the Steam manifest's `name`).
    pub name: String,
    /// Which [`GameSource`] this game was discovered from.
    pub source: GameSource,
    /// Source-scoped external identifier (e.g. a Steam appid), used as the
    /// `(source, external_id)` dedup key.
    pub external_id: Option<String>,
    /// JSON launch descriptor (see `docs/design/non-retro-library-design.md`
    /// §Launch descriptors) describing how to start this game.
    pub launch_descriptor: Value,
    /// A hint for art lookup (e.g. a Steam appid used to key CDN art), if any.
    pub art_hint: Option<String>,
}

/// A pluggable source of non-ROM library games (v0.31 W312/W313). Each
/// implementation encapsulates one external inventory (Steam, `/Applications`,
/// manual entry) and returns the games it can discover; it never persists
/// anything itself.
pub trait GameSourceScanner {
    /// Discover games from this source. An empty result is not an error (e.g.
    /// the source's host application/directory is simply absent).
    fn scan(&self) -> AppResult<Vec<DiscoveredGame>>;
}
