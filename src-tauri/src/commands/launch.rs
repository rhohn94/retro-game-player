//! IPC commands for W7 — RetroArch launch (architecture-design.md §2.3),
//! generalized by v0.31 W311 to dispatch on the game's launch descriptor
//! (`docs/design/non-retro-library-design.md` §Launch descriptors); the
//! `crossover` kind added v0.33 W332 (`docs/design/crossover-integration-design.md`
//! §Launch).
//!
//! Three commands:
//! - `launch_game`        — dispatch on descriptor: RetroArch, or an
//!   external launch (`app`/`steam`/`exec`/`crossover`).
//! - `locate_retroarch`   — probe and return the current RetroArch path.
//! - `set_retroarch_path` — persist a user-chosen path to AppConfig.
//!
//! v0.26 "library life" (W264): `launch_game` also hooks the external play
//! path's session tracking. RetroArch runs as its own process outside
//! Harmony's window, so there is no in-app mount/unmount to hang the
//! start/end pair on — instead a background thread waits on the spawned
//! child and brackets its whole lifetime with `record_play_start`/`_end`.
//! v0.31 W311 extends the same start/end bracketing to `app`/`steam`/`exec`
//! launches, using a best-effort process-termination poll instead of a
//! `Child` wait where `open` itself exits immediately (see
//! `core::launch::observer`'s accuracy caveat). v0.33 W332 extends the same
//! poll-based bracketing to `crossover` (stub-less CrossOver apps spawned via
//! `cxstart`), with an additional Wine-process accuracy caveat documented in
//! `core::launch::observer`'s module doc.

use crate::commands::play_stats::PlayStatsState;
use crate::config::{paths::Paths, AppConfig};
use crate::core::launch::{
    args,
    descriptor::LaunchDescriptor,
    external, external_launcher,
    launcher, locator,
    observer::{self, PgrepObserver, ProcessObserver},
};
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

/// Launch the game identified by `game_id`, dispatching on its stored
/// `launch_descriptor` (v0.31 W311):
///
/// - No descriptor, or `{"kind": "retroarch"}` — the original ROM+core path
///   (steps below), requiring `system` and `path` to be present.
/// - `{"kind": "app" | "steam" | "exec", ...}` — an external launch built by
///   `core::launch::external::build` and spawned by
///   `core::launch::external_launcher::spawn`.
///
/// RetroArch path steps:
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
    let game = LibraryRepo::new(&db).get_game(game_id)?;

    let descriptor = game
        .launch_descriptor
        .as_deref()
        .map(LaunchDescriptor::from_json)
        .transpose()?;

    match descriptor {
        None | Some(LaunchDescriptor::Retroarch) => {
            launch_via_retroarch(game_id, fullscreen, &db, app).await
        }
        Some(external_descriptor) => launch_externally(game_id, &external_descriptor, app).await,
    }
}

/// The original RetroArch ROM+core launch path (W7; unchanged by W311 aside
/// from being factored out of `launch_game` so it can be one branch of the
/// descriptor dispatch).
async fn launch_via_retroarch(
    game_id: i64,
    fullscreen: Option<bool>,
    db: &State<'_, Db>,
    app: AppHandle,
) -> AppResult<()> {
    // --- 1. Config ---
    let paths = Paths::app_support()?;
    let config = AppConfig::load(&paths)?;

    let retroarch_exe = resolve_retroarch_exe(&config)?;

    // --- 3. Game row ---
    let game = LibraryRepo::new(db).get_game(game_id)?;

    // This RetroArch path is ROM-only; non-ROM sources (v0.31 W310/W311)
    // launch externally instead (see `launch_externally`), so both `system`
    // and `path` must be present here.
    let system = game.system.clone().ok_or_else(|| {
        AppError::Unsupported(format!("game {game_id} has no ROM system to launch via RetroArch"))
    })?;
    let path = game.path.clone().ok_or_else(|| {
        AppError::Unsupported(format!("game {game_id} has no ROM path to launch via RetroArch"))
    })?;

    // --- 4. Active core for game's system ---
    let core = CoresRepo::new(db)
        .get_active(&system)?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "no active core configured for system '{system}' — install and activate a core first"
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
        &PathBuf::from(&path),
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

/// Launch a non-RetroArch (`app`/`steam`/`exec`/`crossover`) descriptor and
/// track its play session (v0.31 W311; `crossover` kind added v0.33 W332).
///
/// Session end detection differs by kind: `exec` spawns the game directly,
/// so its `Child` can be waited on exactly like the RetroArch path; `app`/
/// `steam`/`crossover` spawn through `open`/`cxstart`, which exit
/// immediately, so those three use the best-effort `observer` poll instead
/// (see `core::launch::observer`'s accuracy caveat, including the
/// Wine-process caveat specific to `crossover`). Steam titles have no
/// predictable process name to poll (`observer::process_name_for` returns
/// `None`), so their session is ended immediately after launch rather than
/// tracked indefinitely — better an undercount than a session that never
/// closes.
async fn launch_externally(
    game_id: i64,
    descriptor: &LaunchDescriptor,
    app: AppHandle,
) -> AppResult<()> {
    let launch_args = external::build(descriptor)?;
    let child = external_launcher::spawn(&launch_args)?;

    let paths = Paths::app_support()?;
    let db_path = paths.db_file()?;
    let session_id = app.state::<PlayStatsState>().0.start(game_id);

    match descriptor {
        LaunchDescriptor::Exec { .. } => {
            // The spawned child IS the game — wait on it directly, exactly
            // like the RetroArch path.
            spawn_session_watcher(app, db_path, session_id, child);
        }
        LaunchDescriptor::App { .. }
        | LaunchDescriptor::Steam { .. }
        | LaunchDescriptor::Crossover { .. } => {
            match observer::process_name_for(descriptor) {
                Some(process_name) => {
                    spawn_external_observer_watcher(
                        app,
                        db_path,
                        session_id,
                        process_name,
                        PgrepObserver,
                    );
                }
                None => {
                    // No predictable process name to watch (e.g. Steam) —
                    // end the session immediately rather than track forever.
                    end_and_persist_session(&app, &db_path, session_id);
                }
            }
        }
        LaunchDescriptor::Retroarch => unreachable!(
            "launch_externally is never called with a Retroarch descriptor \
             (dispatched to launch_via_retroarch instead)"
        ),
    }

    Ok(())
}

/// Waits on `child` in a background thread, then ends `session_id` and
/// persists the play-stats aggregate update via a fresh db connection.
/// Best-effort: a failure to wait or to persist is logged, never surfaced
/// (the game already launched successfully from the user's perspective).
///
/// Shared by the RetroArch path and `exec`-descriptor external launches
/// (v0.31 W311) — in both cases the spawned `Child` IS the game process.
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
                eprintln!("[play_stats] failed to wait on child process: {e}");
            }
            end_and_persist_session(&app, &db_path, session_id);
        })
        .ok();
}

/// Spawns a background thread that polls `observer` for `process_name`'s
/// liveness (v0.31 W311) and ends `session_id` once it reports the process
/// has stopped. Used for `app`/`steam` descriptors, whose spawned `Child`
/// (the `open` helper) exits immediately and so cannot be waited on the way
/// `spawn_session_watcher` waits on a direct game process — see
/// `core::launch::observer`'s module doc for the accuracy caveat.
fn spawn_external_observer_watcher<O: ProcessObserver + 'static>(
    app: AppHandle,
    db_path: PathBuf,
    session_id: i64,
    process_name: String,
    mut watcher: O,
) {
    std::thread::Builder::new()
        .name(format!("rgp-external-observe-{session_id}"))
        .spawn(move || {
            observer::wait_until_stopped(&mut watcher, &process_name);
            end_and_persist_session(&app, &db_path, session_id);
        })
        .ok();
}

/// Ends `session_id` in the in-memory tracker and persists the play-stats
/// aggregate via a fresh db connection opened at `db_path` (the thread
/// cannot borrow the managed `Db` handle across the IPC call's return, so it
/// opens its own — mirrors `commands::downloads`'s worker pattern). A no-op
/// if the session was already ended. Best-effort: failures are logged, never
/// surfaced (the game already launched successfully from the user's
/// perspective).
fn end_and_persist_session(app: &AppHandle, db_path: &std::path::Path, session_id: i64) {
    let Some((game_id, duration_ms)) = app.state::<PlayStatsState>().0.end(session_id) else {
        return; // already ended (shouldn't happen for this path, but harmless)
    };
    let db = match Db::open(db_path) {
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
