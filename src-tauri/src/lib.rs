//! Harmony backend library crate. `main.rs` is a thin shim calling `run()`.
//! The app builder registers the full IPC surface via the append-only
//! `register_commands!` macro (see `commands/mod.rs`). Master contract §1.2.

pub mod commands;
pub mod error;

/// One-time app setup hook. Later items wire db open + migrate, config load,
/// telemetry, and the fleet server here (W3/W4/W11). For W1 it is a no-op seam.
fn harmony_setup(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
