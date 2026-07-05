//! Native libretro core hosting (v0.21 "Bedrock", generalized in v0.34
//! "Engines" W340, hardware-rendered cores added by W345) — host a libretro
//! core's `.dylib` directly in the Rust backend instead of EmulatorJS/WASM,
//! to fix the Web Audio cold-start audio garble (#15) and WASM load time at
//! the source. Table-driven over [`NATIVE_SYSTEMS`]; the in-page WASM player
//! ([`super::server`]) stays the path for every system not in the table and
//! the automatic fallback if native hosting fails. Most systems render in
//! software (pixel buffers via `retro_video_refresh_t`); a core that
//! negotiates `RETRO_ENVIRONMENT_SET_HW_RENDER` (currently only N64 via
//! mupen64plus_next) instead renders into a headless [`HwRenderContext`]
//! ([`hw_render`]) that Harmony reads back into the same frame pipe. Design:
//! docs/design/native-emulation-design.md.

mod audio;
mod callbacks;
mod clock;
mod ffi;
mod frame;
mod host;
mod hw_render;
mod perf_file;
mod perf_stats;
mod runtime;
mod systems;

pub use callbacks::{
    audio_sample_batch, environment, input_poll, input_state, install, install_hw_render_context,
    set_core_variables, set_joypad_state, uninstall, AudioBatch, CallbackChannels, CoreVariable,
    EnvironmentEvent, PixelFormat, VideoFrame,
};
pub use frame::Rgba8Frame;
pub use host::{CoreSystemInfo, LibretroCore};
pub use hw_render::{HwRenderContext, HwRenderRequest};
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

/// Env-var opt-in guard shared by every `#[ignore]`d test that needs a live
/// CGL/OpenGL context (the `hw_render::tests` context/readback/resize/
/// proc-address/teardown cycle and `runtime`'s HW-render E2E). Plain
/// `cargo test` never runs them (they're `#[ignore]`d, following the
/// `manual_play_produces_audible_output` precedent); opt in on a machine
/// with a real GL stack via:
///
/// ```text
/// RGP_LIVE_GL_TESTS=1 cargo test --manifest-path src-tauri/Cargo.toml -- \
///     --ignored hw_render --skip manual_
/// ```
///
/// The guard panics with that instruction if the variable is missing, so a
/// blanket `cargo test -- --ignored` on a GL-less runner fails loudly and
/// explains itself instead of hanging or segfaulting inside CGL.
#[cfg(test)]
pub(crate) fn require_live_gl_opt_in() {
    if std::env::var("RGP_LIVE_GL_TESTS").is_err() {
        panic!(
            "this test needs a live CGL/OpenGL context — opt in with \
             RGP_LIVE_GL_TESTS=1 cargo test -- --ignored (see \
             docs/design/native-emulation-design.md §HW-render)"
        );
    }
}
