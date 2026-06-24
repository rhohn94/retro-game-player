//! Harmony backend library crate. `main.rs` is a thin shim calling `run()`.
//! The app builder registers the full IPC surface via the append-only
//! `register_commands!` macro (see `commands/mod.rs`). Master contract §1.2.

pub mod commands;
pub mod config;
pub mod error;
pub mod telemetry;

/// One-time app setup hook. Items append their init here (W3 db open + migrate,
/// W11 fleet server). W4 wires the app-support path layout, config load, and the
/// `run.json` telemetry record. Each block is independent and append-friendly.
fn harmony_setup(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // W4 — resolve + create the app-support layout, load (or initialize) the
    // file-backed config, and stamp a run-start telemetry record.
    let paths = config::paths::Paths::app_support()?;
    paths.ensure_all()?;
    let _config = config::AppConfig::load_or_init(&paths)?;
    telemetry::record_run_start(&paths, env!("CARGO_PKG_VERSION"))?;

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
