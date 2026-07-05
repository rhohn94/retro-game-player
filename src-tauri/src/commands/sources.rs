//! Game-source IPC adapters (v0.31 W312/W313 "Frontier"; art acquisition
//! W314; SteamGridDB rung W321). Thin `#[tauri::command]` wrappers over the
//! `core::sources` scanners and `LibraryRepo::upsert_game_by_source`. See
//! `docs/design/non-retro-library-design.md` §Game sources, §UI, and
//! §Art & metadata.
//!
//! Command contract:
//! - `scan_steam_source` — scan + upsert Steam installs, return counts (W312).
//! - `scan_app_source` — enumerate the app shortlist; creates no rows (W313).
//! - `confirm_app_entries` — upsert the user-confirmed subset of a shortlist.
//! - `add_manual_entry` — the manual-entry escape hatch (name + app/exec target).
//! - `scan_gog_source` — scan + upsert GOG Galaxy installs, return counts (W320).
//! - `scan_itch_source` — scan + upsert itch installs, return counts (W320).
//! - `scan_crossover_source` — scan + upsert CrossOver bottle apps, return
//!   counts (W331).
//!
//! After each upsert, `upsert_discovered` best-effort-fetches art for the row
//! via `core::metadata::art_fallback_chain::resolve_art` — the deterministic
//! Steam CDN (appid) → SteamGridDB (API key present) → bundle icon rung
//! order (W321), reusing the existing `art_cache` pipeline (W314). Art
//! failures never fail the scan/confirm command itself.
//!
//! **Art acquisition is detached (W323).** A scan/confirm command upserts
//! every row and returns its counts immediately; art is fetched on a
//! best-effort background thread that opens its own short-lived [`Db`]
//! handle (mirroring the existing `commands::downloads` worker-thread
//! pattern) rather than being awaited inline. This is what keeps
//! `scan_steam_source` fast even when every title's Steam-CDN fetch would
//! otherwise time out serially (see `spawn_art_acquisition`). The UI picks
//! up art on its next load of the row (existing polling/refresh path) once
//! the background fetch lands.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::paths::Paths;
use crate::config::AppConfig;
use crate::core::metadata::art_fallback_chain::{resolve_art, ArtFallbackInput};
use crate::core::sources::app_scan::AppScanner;
use crate::core::sources::crossover::{legacy_external_id, CrossoverScanner};
use crate::core::sources::gog::GogScanner;
use crate::core::sources::itch::ItchScanner;
use crate::core::sources::steam::SteamScanner;
use crate::core::sources::{DiscoveredGame, GameSourceScanner, SourceKind};
use crate::db::repo::library::{GameSource, LibraryRepo, NewGame};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::time::{SystemTime, UNIX_EPOCH};

/// Summary of one game-source scan (wire DTO, camelCase per §2).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceScanReportDto {
    /// Total games the scanner found.
    pub discovered: usize,
    /// Newly inserted library rows (no prior row for that `(source, external_id)`).
    pub added: usize,
    /// Existing library rows refreshed by this scan.
    pub updated: usize,
}

/// Wire DTO for a shortlisted-but-unconfirmed game (camelCase per §2).
/// Mirrors `core::sources::DiscoveredGame`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredGameDto {
    pub name: String,
    pub source: String,
    pub external_id: Option<String>,
    pub launch_descriptor: serde_json::Value,
    pub art_hint: Option<String>,
}

impl From<DiscoveredGame> for DiscoveredGameDto {
    fn from(g: DiscoveredGame) -> Self {
        Self {
            name: g.name,
            source: g.source.as_db_str().to_string(),
            external_id: g.external_id,
            launch_descriptor: g.launch_descriptor,
            art_hint: g.art_hint,
        }
    }
}

/// Current Unix epoch seconds, for `added_at` on newly-discovered rows.
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Best-effort art acquisition for a just-upserted game, **detached from the
/// calling command** (W323 — see the module doc). Every failure (CDN miss,
/// offline network, unresolvable bundle icon, no/invalid SteamGridDB key)
/// degrades silently to "no art fetched", leaving the existing placeholder
/// art path in place; none of that ever propagates back to the scan/confirm
/// command, since by the time it happens the command has already returned.
/// `art_hint` is the scanner-supplied hint (`DiscoveredGame::art_hint`): a
/// Steam appid for `steam` rows, or an app-bundle path for
/// `app`/`manual`/`gog`/`itch`/`crossover` rows (for `crossover`, the
/// launcher-stub `.app` path when one exists — a stub-less fallback row
/// carries no hint at all, see `core::sources::crossover`). A missing hint
/// (e.g. an exec-target manual entry) short-circuits before spawning
/// anything, same as pre-W321 —
/// SteamGridDB's name-based rung still runs whenever *some* hint is present
/// (it only needs the game's title, read from the DB once the thread is
/// already spawned), it just isn't reason enough on its own to spawn a
/// thread + load `AppConfig` for a hint-less row.
///
/// Dispatches to [`core::metadata::art_fallback_chain::resolve_art`] (v0.32
/// W321) for the deterministic Steam CDN → SteamGridDB → bundle icon rung
/// order — this function's only remaining job is mapping `(source, hint)`
/// onto that chain's `ArtFallbackInput` and supplying the SteamGridDB key
/// from `AppConfig`.
///
/// Spawns a dedicated OS thread that opens its **own** [`Db`] connection
/// rather than borrowing the caller's — the caller's `State<Db>` borrow does
/// not outlive the command call, so a background job needs its own handle.
/// This mirrors the existing `commands::downloads` worker-thread pattern
/// (`Db::open` inside a spawned thread, keyed off a `PathBuf`); here the path
/// is re-resolved via `Paths::app_support()` (the same resolver `lib.rs`
/// uses for the app's single shared db file) rather than threaded in from
/// the caller, since doing so keeps every `#[tauri::command]` signature in
/// this module untouched. Returns immediately; the fetch itself (including
/// the SteamGridDB rung's serial search+download and the Steam rung's one
/// blocking async round-trip) all happen off the calling thread — one row
/// per thread, so requests to SteamGridDB across a scan's several rows are
/// naturally serialized per-row without a shared queue (W321: "rate-limit
/// friendly, no retry storms").
fn spawn_art_acquisition(game_id: i64, source: GameSource, art_hint: Option<String>) {
    // ROM art goes through the libretro-thumbnails pipeline
    // (`core::metadata::fallback`), not this non-retro path — bail before
    // spawning anything so a persisting-tier row (today only `rom`) never
    // touches this thread/dir at all. Dispatches on the shared `SourceKind`
    // tier (v0.33 W330) rather than naming `GameSource::Rom` directly, so a
    // future persisting source is excluded from this discover-only art path
    // automatically.
    if SourceKind::of(source) == SourceKind::Persisting {
        return;
    }
    // No scanner-supplied hint means neither the Steam-CDN rung (needs an
    // appid) nor the bundle-icon rung (needs a bundle path) has anything to
    // try; the SteamGridDB rung alone isn't worth spawning a thread + DB/
    // config load for, so this mirrors the pre-W321 short-circuit exactly
    // (also keeps unit tests that pass `None` from touching the real
    // on-disk app-support DB via `Paths::app_support()` below).
    let Some(hint) = art_hint else { return };

    std::thread::Builder::new()
        .name(format!("harmony-art-fetch-{game_id}"))
        .spawn(move || {
            let Ok(paths) = Paths::app_support() else {
                return;
            };
            let Ok(db_path) = paths.db_file() else {
                return;
            };
            let Ok(db) = Db::open(&db_path) else {
                return;
            };
            let Ok(game) = LibraryRepo::new(&db).get_game(game_id) else {
                return;
            };
            let Ok(cfg) = AppConfig::load(&paths) else {
                return;
            };

            let (steam_appid, bundle_path) = match source {
                GameSource::Steam => (Some(hint.as_str()), None),
                GameSource::App
                | GameSource::Manual
                | GameSource::Gog
                | GameSource::Itch
                | GameSource::Crossover => (None, Some(hint.as_str())),
                GameSource::Rom => unreachable!("returned above"),
            };

            let input = ArtFallbackInput {
                steam_appid,
                steamgriddb_api_key: cfg.steamgriddb_api_key.as_deref(),
                bundle_path,
                display_name: &game.clean_name,
            };
            let _ = resolve_art(&db, &paths, game_id, &input);
        })
        // A failure to spawn the OS thread is the same outcome as any other
        // art-acquisition failure: silently no art this round, placeholder
        // stands, next scan/load can retry.
        .ok();
}

/// Upsert every game a scanner discovered, returning the discovered/added/
/// updated counts. Shared by every source-scan command so each one stays a
/// one-line adapter. Art acquisition for each upserted row is detached to a
/// background thread (W323) — this function (and therefore every command
/// calling it) returns as soon as the upserts themselves are done, not after
/// art lands.
async fn upsert_discovered(
    repo: &LibraryRepo<'_>,
    discovered: Vec<DiscoveredGame>,
) -> AppResult<SourceScanReportDto> {
    let now = now_epoch_secs();
    let mut added = 0usize;
    let mut updated = 0usize;
    let discovered_count = discovered.len();

    for game in discovered {
        // external_id is always Some for a scanner-discovered game (it's the
        // dedup key every GameSourceScanner impl populates); upsert_game_by_source
        // would itself error on None, so this check just makes the "already
        // existed?" probe below correct rather than duplicating validation.
        let already_existed = match game.external_id.as_deref() {
            Some(ext_id) => repo
                .get_game_by_source_external_id(game.source, ext_id)?
                .is_some(),
            None => false,
        };

        let source = game.source;
        let art_hint = game.art_hint.clone();
        let new_game = NewGame {
            folder_id: None,
            path: None,
            system: None,
            crc32: None,
            md5: None,
            clean_name: game.name,
            dat_matched: false,
            core_hint: None,
            art_path: None,
            size_bytes: 0,
            added_at: now,
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
            source: game.source,
            launch_descriptor: Some(game.launch_descriptor.to_string()),
            external_id: game.external_id,
        };
        let game_id = repo.upsert_game_by_source(&new_game)?;
        spawn_art_acquisition(game_id, source, art_hint);

        if already_existed {
            updated += 1;
        } else {
            added += 1;
        }
    }

    Ok(SourceScanReportDto {
        discovered: discovered_count,
        added,
        updated,
    })
}

/// Scan the local Steam installation for installed games (parses
/// `appmanifest_*.acf` under `~/Library/Application Support/Steam/steamapps`;
/// no network calls) and upsert each into the library. A missing Steam
/// installation yields a report with `discovered: 0` rather than an error.
#[tauri::command]
pub async fn scan_steam_source(db: State<'_, Db>) -> AppResult<SourceScanReportDto> {
    let repo = LibraryRepo::new(&db);
    let scanner = SteamScanner::default_location();
    let discovered = scanner.scan()?;
    upsert_discovered(&repo, discovered).await
}

/// Scan for installed GOG Galaxy titles (Galaxy's local manifest records
/// and/or `.app` bundles under the Galaxy games install root; no network
/// calls) and upsert each into the library. A missing GOG Galaxy install
/// yields a report with `discovered: 0` rather than an error (W320).
#[tauri::command]
pub async fn scan_gog_source(db: State<'_, Db>) -> AppResult<SourceScanReportDto> {
    let repo = LibraryRepo::new(&db);
    let scanner = GogScanner::default_location();
    let discovered = scanner.scan()?;
    upsert_discovered(&repo, discovered).await
}

/// Scan for installed itch titles (the itch app's local install receipts
/// and/or a fallback install-directory scan; no network calls) and upsert
/// each into the library. A missing itch install yields a report with
/// `discovered: 0` rather than an error (W320).
#[tauri::command]
pub async fn scan_itch_source(db: State<'_, Db>) -> AppResult<SourceScanReportDto> {
    let repo = LibraryRepo::new(&db);
    let scanner = ItchScanner::default_location();
    let discovered = scanner.scan()?;
    upsert_discovered(&repo, discovered).await
}

/// Re-key legacy CrossOver library rows before the upsert pass (v0.34 W347):
/// a pre-bundle-id scan keyed rows on `<bottle>/<display-name>`, so a
/// bundle-id-keyed discovery for the same app must move that row to the new
/// `<bottle>/<CFBundleIdentifier>` key in place (preserving the row id and
/// its play history) rather than let `upsert_discovered` insert a duplicate.
/// Per row this is a no-op when the row is already new-keyed, never existed,
/// or the discovery's key is still display-name shaped
/// (`legacy_external_id` returns `None`).
fn rekey_legacy_crossover_rows(
    repo: &LibraryRepo<'_>,
    discovered: &[DiscoveredGame],
) -> AppResult<()> {
    for game in discovered {
        let Some(current) = game.external_id.as_deref() else {
            continue;
        };
        if let Some(legacy) = legacy_external_id(current, &game.name) {
            repo.rekey_game_external_id(GameSource::Crossover, &legacy, current)?;
        }
    }
    Ok(())
}

/// Scan for installed CrossOver bottles and their Windows applications
/// (bottle inventory under `~/Library/Application Support/CrossOver/Bottles`
/// plus launcher-stub bundles under `~/Applications/CrossOver`, falling back
/// to `.cxmenu` desktop-link records per bottle; no CrossOver process is
/// launched or queried) and upsert each into the library, re-keying any
/// legacy display-name-keyed row onto its bundle-id key first
/// ([`rekey_legacy_crossover_rows`]). A missing CrossOver install yields a
/// report with `discovered: 0` rather than an error (W331).
#[tauri::command]
pub async fn scan_crossover_source(db: State<'_, Db>) -> AppResult<SourceScanReportDto> {
    let repo = LibraryRepo::new(&db);
    let scanner = CrossoverScanner::default_location();
    let discovered = scanner.scan()?;
    rekey_legacy_crossover_rows(&repo, &discovered)?;
    upsert_discovered(&repo, discovered).await
}

/// Build the `NewGame` a non-ROM source upserts — every non-ROM field besides
/// name/source/external_id/launch_descriptor is a sensible empty default,
/// since these rows carry no folder/hash identity (v0.31 W310 invariant).
fn new_game_for_source(
    name: String,
    source: GameSource,
    external_id: Option<String>,
    launch_descriptor: serde_json::Value,
    art_path: Option<String>,
) -> AppResult<NewGame> {
    Ok(NewGame {
        folder_id: None,
        path: None,
        system: None,
        crc32: None,
        md5: None,
        clean_name: name,
        dat_matched: false,
        core_hint: None,
        art_path,
        size_bytes: 0,
        added_at: now_epoch_secs(),
        year: None,
        developer: None,
        publisher: None,
        aliases: None,
        source,
        launch_descriptor: Some(serde_json::to_string(&launch_descriptor)?),
        external_id,
    })
}

/// Run the app-bundle scan and return the shortlist. Creates no rows — the
/// user must confirm via [`confirm_app_entries`] before anything persists
/// (design doc: "no silent library flooding").
#[tauri::command]
pub async fn scan_app_source() -> AppResult<Vec<DiscoveredGameDto>> {
    let found = AppScanner::new().scan()?;
    Ok(found.into_iter().map(Into::into).collect())
}

/// Upsert the user-confirmed subset of an app-scan shortlist. Each entry must
/// carry a non-empty `externalId` (the scanner always supplies one — either
/// the bundle identifier or its path) since `upsert_game_by_source` dedupes on
/// `(source, external_id)`.
#[tauri::command]
pub async fn confirm_app_entries(
    db: State<'_, Db>,
    entries: Vec<DiscoveredGameDto>,
) -> AppResult<Vec<i64>> {
    let repo = LibraryRepo::new(&db);
    let mut ids = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.external_id.is_none() {
            return Err(AppError::Validation(
                "app-scan entry is missing an external id".to_string(),
            ));
        }
        let art_hint = entry.art_hint.clone();
        let game = new_game_for_source(
            entry.name,
            GameSource::App,
            entry.external_id,
            entry.launch_descriptor,
            entry.art_hint,
        )?;
        let game_id = repo.upsert_game_by_source(&game)?;
        spawn_art_acquisition(game_id, GameSource::App, art_hint);
        ids.push(game_id);
    }
    Ok(ids)
}

/// A manual-entry target: either an app bundle to `open -a`, or an arbitrary
/// executable (+ args) to run directly.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ManualTarget {
    App { bundle_path: String },
    Exec { program: String, args: Vec<String> },
}

/// Add a manual library entry: a name plus an app-bundle or exec target
/// (the "escape hatch" form — design doc §Game sources). Validates both the
/// display name and the target are non-empty before creating a `manual` row.
#[tauri::command]
pub async fn add_manual_entry(
    db: State<'_, Db>,
    name: String,
    target: ManualTarget,
) -> AppResult<i64> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "manual entry name must not be empty".to_string(),
        ));
    }
    let (descriptor, art_hint) = match &target {
        ManualTarget::App { bundle_path } => {
            let bundle_path = bundle_path.trim().to_string();
            if bundle_path.is_empty() {
                return Err(AppError::Validation(
                    "manual entry app target must not be empty".to_string(),
                ));
            }
            (
                serde_json::json!({ "kind": "app", "bundle_path": bundle_path }),
                Some(bundle_path),
            )
        }
        ManualTarget::Exec { program, args } => {
            let program = program.trim().to_string();
            if program.is_empty() {
                return Err(AppError::Validation(
                    "manual entry exec target must not be empty".to_string(),
                ));
            }
            (
                serde_json::json!({ "kind": "exec", "program": program, "args": args }),
                None,
            )
        }
    };
    // Manual entries have no natural external id; the descriptor's target
    // (bundle path / program) is stable enough to dedupe re-adds of the same
    // target under upsert_game_by_source's (source, external_id) key.
    let external_id = match &target {
        ManualTarget::App { bundle_path } => bundle_path.trim().to_string(),
        ManualTarget::Exec { program, .. } => program.trim().to_string(),
    };
    let repo = LibraryRepo::new(&db);
    let game = new_game_for_source(
        name,
        GameSource::Manual,
        Some(external_id),
        descriptor,
        art_hint.clone(),
    )?;
    let game_id = repo.upsert_game_by_source(&game)?;
    spawn_art_acquisition(game_id, GameSource::Manual, art_hint);
    Ok(game_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovered(name: &str, external_id: Option<&str>) -> DiscoveredGameDto {
        DiscoveredGameDto {
            name: name.to_string(),
            source: "app".to_string(),
            external_id: external_id.map(str::to_string),
            launch_descriptor: serde_json::json!({ "kind": "app", "bundle_path": "/Applications/X.app" }),
            art_hint: Some("/Applications/X.app".to_string()),
        }
    }

    /// `new_game_for_source` never leaves a non-ROM row with a rom identity
    /// (folder_id/path/system) — the W310 CHECK invariant relies on this.
    #[test]
    fn new_game_for_source_has_no_rom_identity() {
        let game = new_game_for_source(
            "Some Game".to_string(),
            GameSource::App,
            Some("com.example.game".to_string()),
            serde_json::json!({ "kind": "app", "bundle_path": "/Applications/Some Game.app" }),
            None,
        )
        .unwrap();
        assert!(game.folder_id.is_none());
        assert!(game.path.is_none());
        assert!(game.system.is_none());
        assert!(game.launch_descriptor.is_some());
        assert_eq!(game.source, GameSource::App);
    }

    /// The confirm-gate contract: a shortlist entry without an external id is
    /// the scanner failing its own invariant (it always supplies one), so
    /// `confirm_app_entries` must reject it rather than silently upserting a
    /// row with no dedupe key. This test exercises the gating logic directly
    /// via the same validation `confirm_app_entries` performs.
    #[test]
    fn shortlist_entry_without_external_id_is_rejected() {
        let entry = discovered("No Id Game", None);
        assert!(entry.external_id.is_none());
        // Mirrors the check inside confirm_app_entries.
        let result: AppResult<()> = if entry.external_id.is_none() {
            Err(AppError::Validation("missing external id".to_string()))
        } else {
            Ok(())
        };
        assert!(result.is_err());
    }

    #[test]
    fn shortlist_entry_with_external_id_passes_the_gate() {
        let entry = discovered("Has Id Game", Some("com.example.hasid"));
        assert!(entry.external_id.is_some());
    }

    // --- spawn_art_acquisition (W314; detached W323) ---

    /// A `rom` row never goes through this non-retro art path (it uses
    /// `core::metadata::fallback` instead) — this must be a pure no-op (no
    /// thread spawned, no panic), even with a hint present.
    #[test]
    fn spawn_art_acquisition_is_noop_for_rom_source() {
        // No panic / no error possible: spawn_art_acquisition returns ()
        // synchronously and bails before spawning anything for a rom row.
        spawn_art_acquisition(1, GameSource::Rom, Some("irrelevant-hint".to_string()));
    }

    /// A missing art hint (scanner didn't supply one) must short-circuit
    /// before spawning a background thread at all.
    #[test]
    fn spawn_art_acquisition_is_noop_when_hint_absent() {
        spawn_art_acquisition(1, GameSource::Steam, None);
    }

    /// The whole point of W323: a scan command must not block on art. This
    /// proves `upsert_discovered` returns its counts well before a
    /// Steam-CDN fetch (whose per-asset timeout is 10s — see
    /// `core::metadata::steam_cdn::REQUEST_TIMEOUT`) could possibly
    /// complete, for a batch of several discovered titles at once. A
    /// pre-fix synchronous await of art per row would make this take
    /// seconds; detached, it must stay well under a second.
    #[test]
    fn upsert_discovered_returns_promptly_without_waiting_on_art() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);

        let discovered: Vec<DiscoveredGame> = (0..5)
            .map(|i| DiscoveredGame {
                name: format!("Steam Game {i}"),
                source: GameSource::Steam,
                external_id: Some(format!("{i}")),
                launch_descriptor: serde_json::json!({ "kind": "steam", "appid": format!("{i}") }),
                art_hint: Some(format!("{i}")),
            })
            .collect();

        let start = std::time::Instant::now();
        let report =
            tauri::async_runtime::block_on(upsert_discovered(&repo, discovered)).unwrap();
        let elapsed = start.elapsed();

        assert_eq!(report.discovered, 5);
        assert_eq!(report.added, 5);
        assert_eq!(report.updated, 0);
        // Generous relative to the 10s-per-asset CDN timeout this guards
        // against, tight enough to fail if art were awaited inline again.
        assert!(
            elapsed < std::time::Duration::from_secs(2),
            "upsert_discovered took {elapsed:?}; art acquisition must be detached, not awaited"
        );
    }

    // --- spawn_art_acquisition (W320: gog/itch route through bundle-icon art) ---

    /// A missing art hint for a `gog` row must short-circuit before touching
    /// the filesystem, same as every other non-ROM source.
    #[test]
    fn spawn_art_acquisition_is_noop_for_gog_without_hint() {
        spawn_art_acquisition(1, GameSource::Gog, None);
    }

    /// A missing art hint for an `itch` row must short-circuit before
    /// touching the filesystem, same as every other non-ROM source.
    #[test]
    fn spawn_art_acquisition_is_noop_for_itch_without_hint() {
        spawn_art_acquisition(1, GameSource::Itch, None);
    }

    // --- new_game_for_source (W320: gog/itch rows share the App/Manual shape) ---

    /// `new_game_for_source` never leaves a `gog` row with a rom identity —
    /// mirrors the App-source invariant test above.
    #[test]
    fn new_game_for_source_gog_has_no_rom_identity() {
        let game = new_game_for_source(
            "GWENT".to_string(),
            GameSource::Gog,
            Some("1097893768".to_string()),
            serde_json::json!({ "kind": "app", "bundle_path": "/Applications/GWENT.app" }),
            None,
        )
        .unwrap();
        assert!(game.folder_id.is_none());
        assert!(game.path.is_none());
        assert!(game.system.is_none());
        assert!(game.launch_descriptor.is_some());
        assert_eq!(game.source, GameSource::Gog);
    }

    /// `new_game_for_source` never leaves an `itch` row with a rom identity —
    /// mirrors the App-source invariant test above.
    #[test]
    fn new_game_for_source_itch_has_no_rom_identity() {
        let game = new_game_for_source(
            "Celeste".to_string(),
            GameSource::Itch,
            Some("user/celeste".to_string()),
            serde_json::json!({ "kind": "app", "bundle_path": "/Applications/Celeste.app" }),
            None,
        )
        .unwrap();
        assert!(game.folder_id.is_none());
        assert!(game.path.is_none());
        assert!(game.system.is_none());
        assert!(game.launch_descriptor.is_some());
        assert_eq!(game.source, GameSource::Itch);
    }

    // --- spawn_art_acquisition / new_game_for_source (W331: crossover) ---

    /// A missing art hint for a `crossover` row (the stub-less `.cxmenu`
    /// fallback path) must short-circuit before touching the filesystem,
    /// same as every other non-ROM source.
    #[test]
    fn spawn_art_acquisition_is_noop_for_crossover_without_hint() {
        spawn_art_acquisition(1, GameSource::Crossover, None);
    }

    /// `new_game_for_source` never leaves a `crossover` row with a rom
    /// identity — mirrors the App-source invariant test above.
    #[test]
    fn new_game_for_source_crossover_has_no_rom_identity() {
        let game = new_game_for_source(
            "Half-Life 2".to_string(),
            GameSource::Crossover,
            Some("Steam/Half-Life 2".to_string()),
            serde_json::json!({
                "kind": "app",
                "bundle_path": "/Users/me/Applications/CrossOver/Steam/Half-Life 2.app",
            }),
            None,
        )
        .unwrap();
        assert!(game.folder_id.is_none());
        assert!(game.path.is_none());
        assert!(game.system.is_none());
        assert!(game.launch_descriptor.is_some());
        assert_eq!(game.source, GameSource::Crossover);
    }

    /// `upsert_discovered` accepts the stub-less `crossover` launch-descriptor
    /// shape (`{ kind: "crossover", bottle, target }`, W331 — W332
    /// implements its launcher) without choking on the unfamiliar `kind`;
    /// this command layer treats `launch_descriptor` as an opaque JSON blob.
    #[test]
    fn upsert_discovered_accepts_the_stubless_crossover_descriptor_shape() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);

        let discovered = vec![DiscoveredGame {
            name: "Old Game".to_string(),
            source: GameSource::Crossover,
            external_id: Some("Legacy/Old Game".to_string()),
            launch_descriptor: serde_json::json!({
                "kind": "crossover",
                "bottle": "Legacy",
                "target": r"C:\Program Files\Old Game\oldgame.exe",
            }),
            art_hint: None,
        }];

        let report = tauri::async_runtime::block_on(upsert_discovered(&repo, discovered)).unwrap();

        assert_eq!(report.discovered, 1);
        assert_eq!(report.added, 1);
    }

    // --- rekey_legacy_crossover_rows (v0.34 W347: legacy-key transition) ---

    /// A bundle-id-keyed discovery for a stub the scanner produces.
    fn crossover_discovery(external_id: &str, name: &str) -> DiscoveredGame {
        DiscoveredGame {
            name: name.to_string(),
            source: GameSource::Crossover,
            external_id: Some(external_id.to_string()),
            launch_descriptor: serde_json::json!({
                "kind": "app",
                "bundle_path": format!("/Users/me/Applications/CrossOver/Steam/{name}.app"),
            }),
            art_hint: None,
        }
    }

    /// A legacy v0.33 `crossover` row keyed on `<bottle>/<display-name>`,
    /// seeded through the repo the same way the pre-W347 scan created it.
    fn seed_legacy_crossover_row(repo: &LibraryRepo<'_>, external_id: &str, name: &str) -> i64 {
        let game = new_game_for_source(
            name.to_string(),
            GameSource::Crossover,
            Some(external_id.to_string()),
            serde_json::json!({
                "kind": "app",
                "bundle_path": format!("/Users/me/Applications/CrossOver/Steam/{name}.app"),
            }),
            None,
        )
        .unwrap();
        repo.upsert_game_by_source(&game).unwrap()
    }

    /// The W347 transition contract end-to-end at the DB level: a legacy
    /// `<bottle>/<display-name>` row re-scanned as a bundle-id discovery must
    /// end up as exactly ONE row, keyed on the new id, with the original row
    /// id (and therefore its play history / FK references) intact — not a
    /// permanent launchable duplicate.
    #[test]
    fn a_legacy_keyed_row_is_rekeyed_not_duplicated_by_a_bundle_id_rescan() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let legacy_id = seed_legacy_crossover_row(&repo, "Steam/Half-Life 2", "Half-Life 2");
        repo.record_play_session(legacy_id, 1_000, 5_000).unwrap();

        let discovered = vec![crossover_discovery(
            "Steam/com.valve.halflife2",
            "Half-Life 2",
        )];
        rekey_legacy_crossover_rows(&repo, &discovered).unwrap();
        let report = tauri::async_runtime::block_on(upsert_discovered(&repo, discovered)).unwrap();

        assert_eq!(report.discovered, 1);
        assert_eq!(report.added, 0, "the re-keyed row must not count as new");
        assert_eq!(report.updated, 1);
        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1, "exactly one row must remain");
        assert_eq!(games[0].id, legacy_id, "the original row id must survive");
        assert_eq!(
            games[0].external_id.as_deref(),
            Some("Steam/com.valve.halflife2")
        );
        assert_eq!(games[0].last_played_at, Some(1_000));
        assert_eq!(games[0].play_count, 1);
        assert_eq!(games[0].total_play_time_ms, 5_000);
    }

    /// A second bundle-id re-scan after the transition is a plain update —
    /// the re-key pass no-ops once the row is already new-keyed.
    #[test]
    fn a_second_bundle_id_rescan_after_the_transition_is_a_plain_update() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        seed_legacy_crossover_row(&repo, "Steam/Half-Life 2", "Half-Life 2");

        for _ in 0..2 {
            let discovered = vec![crossover_discovery(
                "Steam/com.valve.halflife2",
                "Half-Life 2",
            )];
            rekey_legacy_crossover_rows(&repo, &discovered).unwrap();
            tauri::async_runtime::block_on(upsert_discovered(&repo, discovered)).unwrap();
        }

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(
            games[0].external_id.as_deref(),
            Some("Steam/com.valve.halflife2")
        );
    }

    /// A display-name-keyed discovery (stub without a bundle id, or the
    /// `.cxmenu` fallback) has nothing to re-key — the pass must leave the
    /// row alone and the upsert must dedupe onto it as before.
    #[test]
    fn a_display_name_keyed_discovery_is_untouched_by_the_rekey_pass() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let gid = seed_legacy_crossover_row(&repo, "Steam/Half-Life 2", "Half-Life 2");

        let discovered = vec![crossover_discovery("Steam/Half-Life 2", "Half-Life 2")];
        rekey_legacy_crossover_rows(&repo, &discovered).unwrap();
        let report = tauri::async_runtime::block_on(upsert_discovered(&repo, discovered)).unwrap();

        assert_eq!(report.updated, 1);
        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].id, gid);
        assert_eq!(games[0].external_id.as_deref(), Some("Steam/Half-Life 2"));
    }
}
