//! Native libretro core hosting (v0.21 "Bedrock") — host a libretro core's
//! `.dylib` directly in the Rust backend instead of EmulatorJS/WASM, to fix
//! the Web Audio cold-start audio garble (#15) and WASM load time at the
//! source. NES (`fceumm`) only, behind a flag; the in-page WASM player
//! ([`super::server`]) stays the path for every other system and the
//! automatic fallback if native hosting fails. Design:
//! docs/design/native-emulation-design.md.

mod callbacks;
mod core_path;
mod ffi;
mod frame;
mod host;
mod runtime;

pub use callbacks::{
    audio_sample_batch, environment, input_poll, input_state, install, set_joypad_state,
    uninstall, AudioBatch, CallbackChannels, EnvironmentEvent, PixelFormat, VideoFrame,
};
pub use core_path::{resolve_native_core_path, NATIVE_CORE_ID, NATIVE_SYSTEM};
pub use frame::Rgba8Frame;
pub use host::{CoreSystemInfo, LibretroCore};
pub use runtime::NativeRuntime;
