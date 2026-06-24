//! IPC commands for W7 — RetroArch launch (architecture-design.md §2.3).
//!
//! Three commands:
//! - `launch_game`        — resolve core + locate RetroArch + spawn.
//! - `locate_retroarch`   — probe and return the current RetroArch path.
//! - `set_retroarch_path` — persist a user-chosen path to AppConfig.

use crate::config::{paths::Paths, AppConfig};
use crate::core::launch::{args, launcher, locator};
use crate::db::{
    repo::{library::LibraryRepo, cores::CoresRepo, Repository},
    Db,
};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::State;

/// Launch the game identified by `game_id`.
///
/// Steps:
/// 1. Load AppConfig to read `retroarch_path` and `launch_fullscreen`.
/// 2. Locate RetroArch (override → candidates → Launch Services).
/// 3. Look up the game row to get its filesystem `path` and `system`.
/// 4. Look up the active core for that `system`.
/// 5. Build args and spawn.
///
/// Missing RetroArch → `AppError::Dependency` with an actionable message.
/// Missing active core → `AppError::NotFound`.
#[tauri::command]
pub async fn launch_game(
    game_id: i64,
    fullscreen: Option<bool>,
    db: State<'_, Db>,
) -> AppResult<()> {
    // --- 1. Config ---
    let paths = Paths::app_support()?;
    let config = AppConfig::load(&paths)?;

    let retroarch_exe = resolve_retroarch_exe(&config)?;

    // --- 3. Game row ---
    let game = LibraryRepo::new(&db).get_game(game_id)?;

    // --- 4. Active core for game's system ---
    let core = CoresRepo::new(&db)
        .get_active(&game.system)?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "no active core configured for system '{}' — install and activate a core first",
                game.system
            ))
        })?;

    let core_dylib = core.installed_path.as_deref().ok_or_else(|| {
        AppError::NotFound(format!(
            "core '{}' is not installed (no dylib path) — install it first",
            core.core_id
        ))
    })?;

    // --- 5. Build args + spawn ---
    let use_fullscreen = fullscreen.unwrap_or(config.launch_fullscreen);
    let launch_args = args::build(
        &retroarch_exe,
        &PathBuf::from(core_dylib),
        &PathBuf::from(&game.path),
        use_fullscreen,
    );

    launcher::spawn(&launch_args)
}

/// Probe for the RetroArch executable and return its path, or `null` if absent.
///
/// The frontend uses this to show the current status and decide whether to
/// present the "Install RetroArch" / manual-picker affordance.
#[tauri::command]
pub async fn locate_retroarch() -> AppResult<Option<String>> {
    let paths = Paths::app_support()?;
    let config = AppConfig::load(&paths)?;

    let found = locator::locate(config.retroarch_path.as_deref())?;
    Ok(found.map(|p| p.to_string_lossy().into_owned()))
}

/// Persist `path` as the user's RetroArch override in AppConfig.
///
/// The path is validated to exist before saving. The frontend calls this after
/// the user picks the executable via a file-open dialog (the manual-picker
/// affordance for the missing-RetroArch error path).
#[tauri::command]
pub async fn set_retroarch_path(path: String) -> AppResult<()> {
    if path.is_empty() {
        return Err(AppError::Validation(
            "path must not be empty".to_string(),
        ));
    }

    let exe = locator::executable_for(&PathBuf::from(&path));
    if !exe.exists() {
        return Err(AppError::Io(format!(
            "RetroArch executable not found at '{}' — check the path and try again",
            exe.display()
        )));
    }

    let paths = Paths::app_support()?;
    let mut config = AppConfig::load(&paths)?;
    config.retroarch_path = Some(path);
    config.save(&paths)?;

    Ok(())
}

/// Shared helper: resolve the RetroArch executable path or return a clear
/// `AppError::Dependency` that tells the user to install RetroArch or use
/// `set_retroarch_path` to point to a custom location.
fn resolve_retroarch_exe(config: &AppConfig) -> AppResult<PathBuf> {
    locator::locate(config.retroarch_path.as_deref())?.ok_or_else(|| {
        AppError::Dependency(
            "RetroArch is not installed. \
             Download it from https://www.retroarch.com/ and place it in /Applications, \
             or use set_retroarch_path to specify a custom location."
                .to_string(),
        )
    })
}
