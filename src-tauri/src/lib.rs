//! Retro Game Player backend library crate. `main.rs` is a thin shim calling
//! `run()`. The app builder registers the full IPC surface via the
//! append-only `register_commands!` macro (see `commands/mod.rs`). Master
//! contract §1.2.

pub mod commands;
pub mod config;
pub mod core; // domain logic (cores/library/launch/metadata/search/vibrancy/familiar) — Tauri-free
pub mod db; // W3 — SQLite persistence (handle, migrations, repos)
pub mod fleet; // W11 — Fleet/Ensign: identity, manifest, status server
pub mod play; // v0.15 — in-page WASM play: loopback EmulatorJS host server
pub mod error;
pub mod telemetry;

use tauri::Manager;

/// One-time app setup hook. Each work item appends an independent block here.
/// W4 resolves the app-support layout + config + telemetry; W3 opens the
/// database (running migrations) at the W4-resolved path and manages the `Db`
/// handle in Tauri app state; W11 appends the fleet server below.
fn harmony_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // --- W269: one-time app-data migration for the Harmony -> Retro Game
    // Player rename. MUST run before any DB/config init below — the new
    // `com.retro-game-player.app` app-support dir doesn't exist yet on an
    // upgrading user's machine until this moves it from the old
    // `com.harmony.app` dir. Best-effort: an IO failure here degrades to a
    // fresh-install experience rather than blocking startup. ---
    if let Some(app_support_base) = dirs::data_dir() {
        if let Err(e) = config::migrate::run(&app_support_base) {
            eprintln!("[migrate] app-data migration failed (continuing): {e}");
        }
    }

    // --- W4: app-support layout, config, run-start telemetry ---
    let paths = config::paths::Paths::app_support()?;
    paths.ensure_all()?;
    let _config = config::AppConfig::load_or_init(&paths)?;
    telemetry::record_run_start(&paths, env!("CARGO_PKG_VERSION"))?;

    // --- W360: unhandled-panic observability. Installed as early as possible
    // (right after run-start telemetry has a resolved `Paths`) so it covers
    // the rest of setup too. Additive only — chains to the previous default
    // hook, so stderr output is unaffected (error-telemetry-design.md). ---
    telemetry::install_panic_hook(paths.clone(), env!("CARGO_PKG_VERSION"));

    // --- W3: database (path comes from W4's resolver — reconciliation seam) ---
    let db_path = paths.db_file()?;
    let database = db::Db::open(&db_path)?;
    app.manage(database);

    // --- v0.15: loopback EmulatorJS host server for in-page WASM play. Best-
    // effort (bind failure degrades to the native launch); serves ROMs via its
    // own read-only connection to the same db file, so it never contends for the
    // managed Db handle. v0.23 W231: also bridges EmulatorJS saves to the
    // shared on-disk saves layout. ---
    app.manage(play::start(db_path.clone(), paths.saves_dir()?, paths.ejs_cores_dir()?));

    // --- v0.24 W244: direct-download registry + staging-dir orphan sweep.
    // Worker threads open their own db connection via `db_path`. ---
    let downloads_dir = paths.downloads_dir()?;
    core::search::download::sweep_orphans(&downloads_dir);
    app.manage(commands::downloads::Downloads::new(db_path, downloads_dir));

    // --- v0.21 "Bedrock" W214: holds the single in-flight native libretro
    // core session, if any (see commands::native_play). ---
    app.manage(commands::native_play::NativeSession::default());

    // --- v0.37 W372: holds the armed RetroAchievements set (if any) for the
    // in-flight native session (see commands::achievements). ---
    app.manage(commands::achievements::ActiveAchievementSet::default());

    // --- v0.38 W382: path->hash cache backing get_achievement_summary so a
    // detail-page mount doesn't re-read + re-hash the ROM every time. ---
    app.manage(commands::achievements::RomHashCache::default());

    // --- v0.26 "library life" W264: in-memory play-session tracker shared
    // across all three play paths (see commands::play_stats). ---
    app.manage(commands::play_stats::PlayStatsState::default());

    // --- W11: Fleet/Ensign identity, manifest, localhost status server ---
    // (borrows `paths` before W10 moves it into managed state below).
    let version = env!("CARGO_PKG_VERSION");
    let version_dir = format!("v{version}");
    let ensign = fleet::start(&paths, version, &version_dir)?;
    app.manage(ensign);

    // --- W10: share the resolved Paths for on-demand blurred-hero generation ---
    app.manage(paths);

    Ok(())
}

/// Build, register commands, and run the Retro Game Player application.
pub fn run() {
    // --- W17: opener plugin — allows the frontend to open URLs in the system browser ---
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // v0.12: native file picker for importing ROMs from the filesystem.
        .plugin(tauri_plugin_dialog::init())
        .setup(harmony_setup);

    // The macro is the ONLY place the invoke_handler is assembled; domain items
    // append their commands inside it (commands/mod.rs), never here.
    register_commands!(builder)
        .run(tauri::generate_context!())
        .expect("error while running Retro Game Player");
}
