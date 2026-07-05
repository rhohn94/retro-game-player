//! Metadata & art IPC adapters (W8).
//!
//! Thin `#[tauri::command]` wrappers over the pure domain logic in
//! `core/metadata/`. All blocking work runs on a Tokio blocking task via
//! `tauri::async_runtime::spawn_blocking` so the main thread is never stalled.

use crate::commands::library::GameDto;
use crate::config::paths::Paths;
use crate::core::metadata::art_cache::ArtCacheService;
use crate::core::metadata::cdn_client::ArtTier;
use crate::core::metadata::fallback::{fetch_tier, fetch_with_fallback};
use crate::core::metadata::wikipedia;
use crate::db::repo::library::LibraryRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::State;

/// Wire DTO for one cached art tier (camelCase per architecture-design.md §2).
/// Mirrors TS `CachedArtTier` (`src/ipc/metadata.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedArtTierDto {
    /// Tier key: `"boxart"` | `"title"` | `"snap"`.
    pub tier: String,
    /// On-disk path of the cached full-resolution image for this tier.
    pub path: String,
}

/// Fetch boxart for a game from the libretro-thumbnails CDN, persisting the
/// result under `art-cache/`. Returns the on-disk path of the cached art.
///
/// The 3-tier fallback sequence (full name boxart → short name boxart →
/// title screen → snap) is driven by `core::metadata::fallback`. On a
/// complete CDN miss a placeholder path is returned (empty string signals
/// "no art available" to the frontend).
#[tauri::command]
pub async fn fetch_boxart(game_id: i64, db: State<'_, Db>) -> AppResult<String> {
    let db_ref = db.inner();

    // Look up the game to get its system + clean_name.
    let game = {
        let repo = LibraryRepo::new(db_ref);
        repo.get_game(game_id)
            .map_err(|_| AppError::NotFound(format!("game {game_id} not found")))?
    };

    // libretro-thumbnails art is keyed by ROM system; a non-ROM game (v0.31
    // W310) has no system to look up and gets a graceful miss, not an error.
    let Some(system) = game.system.clone() else {
        return Ok(String::new());
    };
    let clean_name = game.clean_name.clone();

    let paths = Paths::app_support()?;

    // Drive the async fallback chain.
    let result =
        fetch_with_fallback(db_ref, &paths, game_id, &system, &clean_name).await?;

    match result {
        Some(path) => Ok(path),
        // Graceful miss — return empty string; frontend interprets this as
        // "show placeholder". Not an error (art simply isn't on the CDN).
        None => Ok(String::new()),
    }
}

/// Return the on-disk art path for a game if it has already been cached,
/// without hitting the network.
#[tauri::command]
pub async fn get_cached_art(game_id: i64, db: State<'_, Db>) -> AppResult<Option<String>> {
    let db_ref = db.inner();
    let paths = Paths::app_support()?;
    let svc = ArtCacheService::new(db_ref, &paths);
    svc.best_cached_path(game_id)
}

/// Fetch ONE named art tier for a game at full CDN resolution, independent of
/// the other tiers (W263 — high-resolution + full-bleed artwork pipeline).
///
/// Unlike `fetch_boxart` (which stops at the first tier that hits), this
/// fetches exactly `tier` — allowing a hero surface to request `Named_Snaps`
/// even when a boxart is already cached. Concurrent-safe and idempotent: two
/// overlapping calls for the same `(game_id, tier)` both resolve to the same
/// on-disk file (the second simply re-writes the identical bytes and
/// re-upserts the same `art_cache` row).
///
/// `tier` is one of `"boxart"` | `"title"` | `"snap"` (matches
/// `ArtTier::db_key`); any other value is an `AppError::Validation`.
///
/// Returns the on-disk path on a cache hit, or an empty string on a graceful
/// per-tier CDN miss (e.g. a game with boxart but no snap) — the frontend
/// treats that the same as `fetch_boxart`'s empty-string miss signal.
#[tauri::command]
pub async fn fetch_game_art(
    game_id: i64,
    tier: String,
    db: State<'_, Db>,
) -> AppResult<String> {
    let art_tier = ArtTier::from_db_key(&tier)
        .ok_or_else(|| AppError::Validation(format!("unknown art tier '{tier}'")))?;

    let db_ref = db.inner();
    let game = {
        let repo = LibraryRepo::new(db_ref);
        repo.get_game(game_id)
            .map_err(|_| AppError::NotFound(format!("game {game_id} not found")))?
    };

    // Same system-keyed CDN constraint as `fetch_boxart`: a non-ROM game has
    // no system, so this is a graceful miss (v0.31 W310).
    let Some(system) = game.system.clone() else {
        return Ok(String::new());
    };
    let paths = Paths::app_support()?;
    let result = fetch_tier(
        db_ref,
        &paths,
        game_id,
        &system,
        &game.clean_name,
        art_tier,
    )
    .await?;

    match result {
        Some(path) => Ok(path),
        None => Ok(String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::library::{GameSource, LibraryRepo, NewGame};
    use crate::db::Db;

    fn seed_game(db: &Db, system: Option<&str>, source: GameSource) -> i64 {
        LibraryRepo::new(db)
            .add_game(&NewGame {
                folder_id: None,
                // The `games` table's CHECK constraint requires a ROM row to
                // carry both `path` and `system` together (or else a
                // `launch_descriptor`) — mirror that pairing here.
                path: system.map(|_| "/roms/test.rom".to_string()),
                system: system.map(str::to_string),
                crc32: None,
                md5: None,
                clean_name: "Test Game".to_string(),
                dat_matched: false,
                core_hint: None,
                art_path: None,
                size_bytes: 0,
                added_at: 0,
                year: None,
                developer: None,
                publisher: None,
                aliases: None,
                source,
                launch_descriptor: if source == GameSource::Rom {
                    None
                } else {
                    Some(r#"{"kind":"app","bundle_path":"/Applications/X.app"}"#.to_string())
                },
                external_id: None,
            })
            .expect("seed game")
    }

    /// Mirrors `fetch_boxart`/`fetch_game_art`'s shared game-lookup step: an
    /// unknown id maps a bare rusqlite-not-found into the same
    /// `AppError::NotFound(format!("game {id} not found"))` both commands
    /// return, rather than surfacing the repo's raw error. Exercised against
    /// a plain `&Db` since the real commands take `State<'_, Db>`, which —
    /// like every other command module in this crate — cannot be constructed
    /// outside a running `tauri::App` (see `commands::native_play`'s
    /// `list_native_systems_at` for the same pattern).
    fn lookup_game_or_not_found(db: &Db, game_id: i64) -> AppResult<crate::db::repo::library::Game> {
        LibraryRepo::new(db)
            .get_game(game_id)
            .map_err(|_| AppError::NotFound(format!("game {game_id} not found")))
    }

    #[test]
    fn lookup_maps_a_missing_game_to_not_found() {
        let db = Db::open_in_memory().unwrap();
        let err = lookup_game_or_not_found(&db, 999).expect_err("missing game");
        match err {
            AppError::NotFound(detail) => assert_eq!(detail, "game 999 not found"),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    /// A non-ROM game (v0.31 W310) has no `system`, so both `fetch_boxart`
    /// and `fetch_game_art` treat it as a graceful miss rather than an error
    /// — this confirms the `system` field itself carries that signal for a
    /// freshly-seeded non-ROM row.
    #[test]
    fn a_non_rom_game_has_no_system_to_key_cdn_art_lookup_by() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db, None, GameSource::App);
        let game = lookup_game_or_not_found(&db, game_id).expect("seeded game found");
        assert!(game.system.is_none());
    }

    #[test]
    fn a_rom_game_carries_its_system_for_cdn_art_lookup() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db, Some("nes"), GameSource::Rom);
        let game = lookup_game_or_not_found(&db, game_id).expect("seeded game found");
        assert_eq!(game.system.as_deref(), Some("nes"));
    }
}

/// Return every art tier already cached on disk for a game, without hitting
/// the network (W263). Ordered boxart → title → snap; a game with no cached
/// art of any tier yields an empty list.
#[tauri::command]
pub async fn get_cached_art_tiers(
    game_id: i64,
    db: State<'_, Db>,
) -> AppResult<Vec<CachedArtTierDto>> {
    let db_ref = db.inner();
    let paths = Paths::app_support()?;
    let svc = ArtCacheService::new(db_ref, &paths);
    let tiers = svc.cached_tiers(game_id)?;
    Ok(tiers
        .into_iter()
        .map(|(tier, path)| CachedArtTierDto { tier, path })
        .collect())
}

/// Auto-download relevant metadata for a game just added to the library: cover
/// art (libretro-thumbnails CDN) and a Wikipedia description + canonical URL.
///
/// Both sources are **best-effort** — an unsupported system, a CDN miss, or a
/// Wikipedia miss is not an error; the un-enriched fields simply stay as they
/// were. Returns the (possibly updated) game so the UI can refresh in place.
/// This is invoked automatically after an import and on a manual "refresh
/// metadata" action.
#[tauri::command]
pub async fn enrich_game_metadata(game_id: i64, db: State<'_, Db>) -> AppResult<GameDto> {
    let db_ref = db.inner();

    let (system, clean_name) = {
        let repo = LibraryRepo::new(db_ref);
        let g = repo
            .get_game(game_id)
            .map_err(|_| AppError::NotFound(format!("game {game_id} not found")))?;
        (g.system.clone(), g.clean_name.clone())
    };

    let paths = Paths::app_support()?;

    // Cover art — fetch_with_fallback persists the art and updates games.art_path
    // on a hit. Swallow Unsupported (system without a CDN folder) and network
    // errors so enrichment never fails over missing art. A non-ROM game
    // (v0.31 W310) has no system, so this step is simply skipped for it.
    if let Some(system) = system.as_deref() {
        let _ = fetch_with_fallback(db_ref, &paths, game_id, system, &clean_name).await;
    }

    // Wikipedia description (best-effort).
    if let Ok(Some(summary)) = wikipedia::fetch_summary(&clean_name, "video game").await {
        LibraryRepo::new(db_ref).set_game_enrichment(
            game_id,
            Some(&summary.extract),
            summary.page_url.as_deref(),
        )?;
    }

    Ok(LibraryRepo::new(db_ref).get_game(game_id)?.into())
}
