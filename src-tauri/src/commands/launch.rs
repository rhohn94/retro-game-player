//! IPC commands for W7 — RetroArch launch (architecture-design.md §2.3).
//!
//! Three commands:
//! - `launch_game`        — resolve core + locate RetroArch + spawn.
//! - `locate_retroarch`   — probe and return the current RetroArch path.
//! - `set_retroarch_path` — persist a user-chosen path to AppConfig.
//!
//! v0.26 "library life" (W264): `launch_game` also hooks the external play
//! path's session tracking. RetroArch runs as its own process outside
//! Harmony's window, so there is no in-app mount/unmount to hang the
//! start/end pair on — instead a background thread waits on the spawned
//! child and brackets its whole lifetime with `record_play_start`/`_end`.

use crate::commands::play_stats::PlayStatsState;
use crate::config::{paths::Paths, AppConfig};
use crate::core::launch::{args, launcher, locator};
use crate::db::{
    repo::{library::LibraryRepo, cores::CoresRepo, Repository},
    Db,
};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

/// Current Unix epoch seconds, used to stamp `last_played_at` at session end.
/// Mirrors `commands::play_stats::now_epoch_secs` (kept module-local since
/// this thread never has a `commands::play_stats` import worth sharing a
/// single-line helper over — a shared time source would be over-engineering
/// for a one-line `SystemTime` call).
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Launch the game identified by `game_id`.
///
/// Steps:
/// 1. Load AppConfig to read `retroarch_path` and `launch_fullscreen`.
/// 2. Locate RetroArch (override → candidates → Launch Services).
/// 3. Look up the game row to get its filesystem `path` and `system`.
/// 4. Look up the active core for that `system`.
/// 5. Build args and spawn.
/// 6. (v0.26 W264) Track the session on a background thread bracketing the
///    spawned RetroArch process's whole lifetime.
///
/// Missing RetroArch → `AppError::Dependency` with an actionable message.
/// Missing active core → `AppError::NotFound`.
#[tauri::command]
pub async fn launch_game(
    game_id: i64,
    fullscreen: Option<bool>,
    db: State<'_, Db>,
    app: AppHandle,
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

    let child = launcher::spawn(&launch_args)?;

    // --- 6. Library-life session tracking (v0.26 W264) ---
    // RetroArch is its own top-level process — there's no in-app
    // mount/unmount to hang a start/end pair on the way the two in-app play
    // paths do. Instead: start the session now (the tracker is Tauri-free,
    // so this call is synchronous and infallible from here), then spawn a
    // background thread that waits on the child and ends the session the
    // moment it actually exits. The thread opens its OWN db connection via
    // `db_path` (mirrors `commands::downloads`'s worker pattern) since the
    // managed `Db` handle's borrow can't cross this call's return.
    let db_path = paths.db_file()?;
    let session_id = app.state::<PlayStatsState>().0.start(game_id);
    spawn_session_watcher(app, db_path, session_id, child);

    Ok(())
}

/// Waits on `child` in a background thread, then ends `session_id` and
/// persists the play-stats aggregate update via a fresh db connection.
/// Best-effort: a failure to wait or to persist is logged, never surfaced
/// (the game already launched successfully from the user's perspective).
fn spawn_session_watcher(
    app: AppHandle,
    db_path: PathBuf,
    session_id: i64,
    mut child: std::process::Child,
) {
    std::thread::Builder::new()
        .name(format!("rgp-external-play-{session_id}"))
        .spawn(move || {
            if let Err(e) = child.wait() {
                eprintln!("[play_stats] failed to wait on RetroArch child: {e}");
            }
            let Some((game_id, duration_ms)) = app.state::<PlayStatsState>().0.end(session_id)
            else {
                return; // already ended (shouldn't happen for this path, but harmless)
            };
            let db = match Db::open(&db_path) {
                Ok(db) => db,
                Err(e) => {
                    eprintln!("[play_stats] failed to open db to record session end: {e}");
                    return;
                }
            };
            if let Err(e) =
                LibraryRepo::new(&db).record_play_session(game_id, now_epoch_secs(), duration_ms)
            {
                eprintln!("[play_stats] failed to record play session: {e}");
            }
        })
        .ok();
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
