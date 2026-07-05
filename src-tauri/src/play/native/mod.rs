//! Native libretro core hosting (v0.21 "Bedrock", generalized in v0.34
//! "Engines" W340) — host a libretro core's `.dylib` directly in the Rust
//! backend instead of EmulatorJS/WASM, to fix the Web Audio cold-start audio
//! garble (#15) and WASM load time at the source. Table-driven over
//! [`NATIVE_SYSTEMS`] (NES/`fceumm` only so far — later items append rows);
//! the in-page WASM player ([`super::server`]) stays the path for every
//! system not in the table and the automatic fallback if native hosting
//! fails. Design: docs/design/native-emulation-design.md.

mod audio;
mod callbacks;
mod clock;
mod ffi;
mod frame;
mod host;
mod perf_file;
mod perf_stats;
mod runtime;
mod systems;

pub use callbacks::{
    audio_sample_batch, environment, input_poll, input_state, install, set_core_variables,
    set_joypad_state, uninstall, AudioBatch, CallbackChannels, CoreVariable, EnvironmentEvent,
    PixelFormat, VideoFrame,
};
pub use frame::Rgba8Frame;
pub use host::{CoreSystemInfo, LibretroCore};
pub use runtime::NativeRuntime;
pub use systems::{
    is_native_capable, native_support_for, resolve_native_core_path, NativeSystemSupport,
    NATIVE_CORE_ID, NATIVE_SYSTEM, NATIVE_SYSTEMS,
};

/// Test-only re-export: the lock serializing every test (in this module or
/// elsewhere in the crate) that drives [`callbacks`]'s process-global FFI
/// callback state directly — see `callbacks::lock_tests`'s doc.
#[cfg(test)]
pub(crate) use callbacks::lock_tests;
