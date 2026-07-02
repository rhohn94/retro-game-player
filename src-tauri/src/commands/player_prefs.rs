//! Player-preference IPC (v0.24 W243, #22): the in-game volume and the
//! pause-on-window-blur behavior, persisted in [`AppConfig`] so they apply
//! to both play paths across sessions. See
//! docs/design/in-page-play-design.md §8.

use crate::config::{paths::Paths, AppConfig};
use crate::error::AppResult;
use serde::Serialize;

/// The persisted player preferences (mirrors the frontend's `PlayerPrefs`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerPrefsDto {
    /// In-game audio volume [0, 1].
    pub volume: f32,
    /// Pause the running game when the window loses focus.
    pub pause_on_blur: bool,
}

/// The current player preferences.
#[tauri::command]
pub fn get_player_prefs() -> AppResult<PlayerPrefsDto> {
    let cfg = AppConfig::load(&Paths::app_support()?)?;
    Ok(PlayerPrefsDto {
        volume: cfg.player_volume,
        pause_on_blur: cfg.pause_on_blur,
    })
}

/// Persists the player preferences. Volume is clamped to [0, 1] — the UI's
/// slider can't exceed it, but the IPC boundary shouldn't trust that.
#[tauri::command]
pub fn set_player_prefs(volume: f32, pause_on_blur: bool) -> AppResult<()> {
    let paths = Paths::app_support()?;
    let mut cfg = AppConfig::load(&paths)?;
    cfg.player_volume = volume.clamp(0.0, 1.0);
    cfg.pause_on_blur = pause_on_blur;
    cfg.save(&paths)
}
