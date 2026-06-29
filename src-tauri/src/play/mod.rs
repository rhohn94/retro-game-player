//! In-page WASM play (v0.15). Runs a supported game's EmulatorJS core inside the
//! Harmony detail screen by serving the emulator + ROM from a real loopback HTTP
//! origin (see [`server`]) that the frontend embeds in an `<iframe>` — the only
//! reliable way to host EmulatorJS's Worker/WASM pipeline under `tauri://`.
//!
//! The native external-RetroArch launch (`commands::launch`) is unchanged; this
//! is the embedded path for the cartridge systems whose cores are bundled.

pub mod server;

pub use server::{start, PlayServer};
