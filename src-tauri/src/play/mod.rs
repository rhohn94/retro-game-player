//! In-page WASM play (v0.15). Runs a supported game's EmulatorJS core inside the
//! Harmony detail screen by serving the emulator + ROM from a real loopback HTTP
//! origin (see [`server`]) that the frontend embeds in an `<iframe>` — the only
//! reliable way to host EmulatorJS's Worker/WASM pipeline under `tauri://`.
//!
//! The native external-RetroArch launch (`commands::launch`) is unchanged; this
//! is the embedded path for the cartridge systems whose cores are bundled.
//!
//! [`native`] (v0.21 "Bedrock") is a second embedded path — hosting a libretro
//! core's `.dylib` directly instead of via EmulatorJS/WASM — landing
//! incrementally behind a flag; see docs/design/native-emulation-design.md.

pub mod native;
pub mod server;

pub use server::{start, PlayServer};
