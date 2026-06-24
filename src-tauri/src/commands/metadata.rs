//! Metadata & art IPC adapters (W8).
//!
//! Thin `#[tauri::command]` wrappers over the pure domain logic in
//! `core/metadata/`. All blocking work runs on a Tokio blocking task via
//! `tauri::async_runtime::spawn_blocking` so the main thread is never stalled.

use crate::config::paths::Paths;
use crate::core::metadata::art_cache::ArtCacheService;
use crate::core::metadata::fallback::fetch_with_fallback;
use crate::db::repo::library::LibraryRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use tauri::State;

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

    let system = game.system.clone();
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
