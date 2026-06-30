//! Native libretro core hosting (v0.21 "Bedrock") — host a libretro core's
//! `.dylib` directly in the Rust backend instead of EmulatorJS/WASM, to fix
//! the Web Audio cold-start audio garble (#15) and WASM load time at the
//! source. NES (`fceumm`) only, behind a flag; the in-page WASM player
//! ([`super::server`]) stays the path for every other system and the
//! automatic fallback if native hosting fails. Design:
//! docs/design/native-emulation-design.md.

mod ffi;
mod host;

pub use host::{CoreSystemInfo, LibretroCore};
