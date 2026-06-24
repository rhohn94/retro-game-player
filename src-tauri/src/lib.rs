//! Harmony backend library crate. `main.rs` is a thin shim calling `run()`.
//! The app builder registers the full IPC surface via the append-only
//! `register_commands!` macro (see `commands/mod.rs`). Master contract §1.2.

pub mod commands;
pub mod config;
pub mod core; // domain logic (W5 cores, …) — Tauri-free, unit-testable
pub mod db; // W3 — SQLite persistence (handle, migrations, repos)
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
    let database = db::Db::open(&paths.db_file()?)?;
    app.manage(database);

    // --- APPEND FURTHER SETUP BLOCKS BELOW THIS LINE (W11) ---
    Ok(())
}

/// Build, register commands, and run the Harmony application.
pub fn run() {
    let builder = tauri::Builder::default().setup(harmony_setup);

    // The macro is the ONLY place the invoke_handler is assembled; domain items
    // append their commands inside it (commands/mod.rs), never here.
    register_commands!(builder)
        .run(tauri::generate_context!())
        .expect("error while running Harmony");
}
