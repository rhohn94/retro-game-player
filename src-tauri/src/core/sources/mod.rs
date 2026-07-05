//! Game-source scanner abstraction (v0.31 "Frontier" — see
//! `docs/design/non-retro-library-design.md` §Game sources; tier
//! reconciliation v0.33 W330 — see `docs/design/crossover-integration-design.md`
//! §Trait shape).
//!
//! Two explicit tiers, deliberately kept separate rather than collapsed into
//! one lowest-common-denominator trait:
//!
//! - [`GameSourceScanner`] — discover-only. A scanner returns
//!   [`DiscoveredGame`]s without touching the database; the IPC command layer
//!   (`commands::sources`) maps them onto `LibraryRepo::upsert_game_by_source`.
//!   Every non-ROM source (steam, app, manual, gog, itch — and crossover,
//!   W331) is this tier.
//! - [`PersistingSource`] — owns its own persistence. A ROM folder scan must
//!   walk a specific content folder, hash each candidate, consult the DAT,
//!   and dedupe against already-known paths in one pass, so the scan and the
//!   write are inseparable; today only [`rom::RomSource`] implements it.
//!
//! Both tiers report through the same [`ScanReport`] shape so the IPC layer
//! doesn't need tier-specific counts vocabulary, and [`SourceKind::of`] maps
//! every `games.source` value onto its tier so scan-command adapters can stay
//! thin without hardcoding the source list themselves.
//!
//! Keep this file minimal: each scanner implementation lives in its own
//! module (e.g. `steam.rs`).

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

/// Summary of one persisting-source scan, shared by every [`PersistingSource`]
/// implementation (today only [`rom::RomSource`]) so the IPC layer sees one
/// counts shape regardless of tier. Mirrors the TS `ScanReport` (§2.1).
///
/// Lifted out of `sources::rom` in v0.33 W330 (was previously ROM-specific)
/// so a future persisting source shares this vocabulary rather than
/// redeclaring it; `rom` re-exports it for its existing call sites.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    /// The content folder that was scanned.
    pub folder_id: i64,
    /// Total candidate files the walker found.
    pub scanned: usize,
    /// Candidates matched against the DAT (`dat_matched = true`).
    pub identified: usize,
    /// Candidates with no DAT match (flagged for the UI).
    pub unidentified: usize,
    /// New game rows inserted this scan (excludes already-present paths).
    pub added: usize,
}

/// A game source that owns its own persistence (v0.33 W330 — see
/// `docs/design/crossover-integration-design.md` §Trait shape). Unlike
/// [`GameSourceScanner`] (stateless discovery the IPC layer upserts
/// generically), a persisting source's identity/dedup logic is inseparable
/// from the scan itself (e.g. a ROM's dedup key is its on-disk path, hashed
/// and matched in the same pass) — so it writes directly via its own repo
/// calls and reports back the shared [`ScanReport`] shape.
///
/// `Args` is the per-implementation scan input (e.g. `RomSource` needs a
/// folder id, a root path, and an optional DAT index); keeping it generic
/// lets each persisting source describe its own scan inputs without forcing
/// a lowest-common-denominator argument list onto the trait.
pub trait PersistingSource {
    /// The scan-input type this source needs (folder root, credentials, etc).
    /// No `Self: 'a` bound: the args type describes the scan's own inputs
    /// (e.g. a borrowed root path), not a borrow of the source itself, so an
    /// implementor whose own lifetime is shorter than the args' lifetime
    /// (e.g. `RomSource<'a>` scanning with a longer-lived `RomScanArgs<'b>`)
    /// is not spuriously rejected.
    type Args<'a>;

    /// Scan and persist in one pass, returning the shared [`ScanReport`].
    fn scan_and_persist(&self, args: Self::Args<'_>) -> AppResult<ScanReport>;
}

/// Which persistence tier a `games.source` value belongs to (v0.33 W330).
/// Every value in [`GameSource`] maps to exactly one tier, so scan-command
/// adapters (`commands::library`, `commands::sources`) can dispatch on this
/// rather than hardcoding "rom is special" checks inline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    /// Discovers stateless rows the IPC layer upserts generically — every
    /// non-ROM source today (steam, app, manual, gog, itch).
    Discovering,
    /// Owns its own persistence — today only `rom`.
    Persisting,
}

impl SourceKind {
    /// Resolve the tier for a `games.source` value.
    pub fn of(source: GameSource) -> Self {
        match source {
            GameSource::Rom => SourceKind::Persisting,
            GameSource::Steam
            | GameSource::App
            | GameSource::Manual
            | GameSource::Gog
            | GameSource::Itch => SourceKind::Discovering,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every `GameSource` variant must resolve to a tier — this test is the
    /// living documentation that a new source (e.g. `crossover`, W331) must
    /// be added to `SourceKind::of` explicitly rather than falling through a
    /// wildcard arm (there is none, by design: the match is exhaustive).
    #[test]
    fn source_kind_of_covers_every_source() {
        assert_eq!(SourceKind::of(GameSource::Rom), SourceKind::Persisting);
        assert_eq!(SourceKind::of(GameSource::Steam), SourceKind::Discovering);
        assert_eq!(SourceKind::of(GameSource::App), SourceKind::Discovering);
        assert_eq!(SourceKind::of(GameSource::Manual), SourceKind::Discovering);
        assert_eq!(SourceKind::of(GameSource::Gog), SourceKind::Discovering);
        assert_eq!(SourceKind::of(GameSource::Itch), SourceKind::Discovering);
    }

    /// Only `rom` is a persisting source today (design doc: CrossOver arrives
    /// tier-1/discovering, W331) — pin that so a future change to the
    /// default tier assignment is a deliberate, reviewed edit.
    #[test]
    fn only_rom_is_persisting_today() {
        let persisting: Vec<GameSource> = [
            GameSource::Rom,
            GameSource::Steam,
            GameSource::App,
            GameSource::Manual,
            GameSource::Gog,
            GameSource::Itch,
        ]
        .into_iter()
        .filter(|s| SourceKind::of(*s) == SourceKind::Persisting)
        .collect();
        assert_eq!(persisting, vec![GameSource::Rom]);
    }
}
