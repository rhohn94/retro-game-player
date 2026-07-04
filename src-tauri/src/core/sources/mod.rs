//! Game-source abstraction (v0.31 W312/W313 — see
//! `docs/design/non-retro-library-design.md` §Game sources).
//!
//! A `GameSourceScanner` enumerates external game inventories (Steam library,
//! `/Applications`, …) and reports what it finds as a `DiscoveredGame`
//! shortlist; the caller (an IPC adapter) decides whether/how to persist rows.
//! Kept intentionally minimal — each concrete scanner lives in its own file
//! and is declared as a `pub mod` below (append-only, so parallel work items
//! merge by concatenation).

use crate::db::repo::library::GameSource;
use crate::error::AppResult;

pub mod app_scan; // W313 — /Applications + ~/Applications game-category scan

/// One game found by a `GameSourceScanner`, before any library row exists.
/// Carries everything an IPC adapter needs to either show a confirm-gated
/// shortlist entry (apps) or upsert directly (Steam) via
/// `LibraryRepo::upsert_game_by_source`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct DiscoveredGame {
    pub name: String,
    pub source: GameSource,
    pub external_id: Option<String>,
    pub launch_descriptor: serde_json::Value,
    pub art_hint: Option<String>,
}

/// A pluggable enumerator for one external game inventory. Implementors must
/// never fail merely because the underlying inventory is absent (e.g. no
/// Steam install) — an empty `Vec` is the correct result for "nothing found",
/// reserving `Err` for genuine I/O/parse failures.
pub trait GameSourceScanner {
    fn scan(&self) -> AppResult<Vec<DiscoveredGame>>;
}
