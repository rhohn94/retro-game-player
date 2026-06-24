//! Tauri command adapter for the vibrancy domain (W10).
//!
//! Exposes `get_blurred_hero` — the IPC entry point. Heavy image work runs
//! off the UI thread via `tokio::task::spawn_blocking` so the window stays
//! responsive during the first (cache-miss) blur computation.

use tauri::State;

use crate::config::paths::Paths;
use crate::core::vibrancy::blur_cache::{self, BlurredHero};
use crate::error::{AppError, AppResult};

/// Produce or retrieve the pre-blurred hero bitmap for `game_id`.
///
/// `art_path` is the absolute filesystem path to the game's cover art
/// (the value stored in `games.art_path` / the art-cache, owned by W8).
/// On the first call for a game the image is loaded, downscaled, blurred,
/// and written to `blur-cache/<game_id>.png`; subsequent calls return the
/// cached file without recomputing.
///
/// Runs off the UI thread via `tauri::async_runtime::spawn_blocking` so the
/// Tauri event loop stays responsive during the first (cache-miss) computation.
#[tauri::command]
pub async fn get_blurred_hero(
    game_id: i64,
    art_path: String,
    paths: State<'_, Paths>,
) -> AppResult<BlurredHero> {
    // Clone the State inner value so we can move it into the blocking task.
    let paths = paths.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        blur_cache::get_or_compute(&paths, game_id, &art_path)
    })
    .await
    .map_err(|e| AppError::Internal(format!("task join error: {e}")))?
}
