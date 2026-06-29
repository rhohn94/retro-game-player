//! Harmony backend library crate. `main.rs` is a thin shim calling `run()`.
//! The app builder registers the full IPC surface via the append-only
//! `register_commands!` macro (see `commands/mod.rs`). Master contract §1.2.

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
    // --- W4: app-support layout, config, run-start telemetry ---
    let paths = config::paths::Paths::app_support()?;
    paths.ensure_all()?;
    let _config = config::AppConfig::load_or_init(&paths)?;
    telemetry::record_run_start(&paths, env!("CARGO_PKG_VERSION"))?;

    // --- W3: database (path comes from W4's resolver — reconciliation seam) ---
    let db_path = paths.db_file()?;
    let database = db::Db::open(&db_path)?;
    app.manage(database);

    // --- v0.15: loopback EmulatorJS host server for in-page WASM play. Best-
    // effort (bind failure degrades to the native launch); serves ROMs via its
    // own read-only connection to the same db file, so it never contends for the
    // managed Db handle. ---
    app.manage(play::start(db_path));

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

/// Build, register commands, and run the Harmony application.
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
        .expect("error while running Harmony");
}
