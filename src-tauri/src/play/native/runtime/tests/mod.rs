//! Headless native-path integration tests (W284, issue #28 — "Native-path
//! smoke: load a real (stub) test ROM through the actual NativeRuntime/FFI
//! host headlessly, and assert frames + audio samples are genuinely
//! produced"). CI-safe, automated counterpart to `super::manual`: instead of
//! an installed real `fceumm_libretro.dylib` + a real ROM (both
//! environment-dependent and gated behind `--ignored`), each submodule here
//! builds a synthetic stub core at test time via `cc` — the exact same
//! convention `host.rs`'s `build_stub_core` and `commands::native_play`'s own
//! `build_stub_core` already use — that deterministically emits checkable
//! video/audio content on every `retro_run`, so assertions can check *real
//! produced content* (not just "no error") without depending on any
//! bundled/copyrighted ROM or real audio hardware.
//!
//! Split by stub-core family (W363, v0.36 "Spring Cleaning" — pure-move, no
//! logic changes):
//! - `av_core`: the baseline stub proving genuine video + audio content flows
//!   end to end, both at the raw FFI layer and through the real
//!   [`super::NativeRuntime::start`] entrypoint, plus the multi-port
//!   controller-announce coverage that reuses the same stub family.
//! - `input_probe`: the W350 stale-input regression stub (a fresh session
//!   must read all-zero input despite stray between-session state).
//! - `alt_geometry`: a second, differently-shaped software-rendered "system"
//!   (W340) proving no hard-coded NES assumption remains in the host.
//! - `cohort`: the v0.34 "Engines" software-render cohort's three pixel
//!   formats plus a mid-game `SET_GEOMETRY` renegotiation (W342).
//! - `hw_render`: the W345 HW-render (CGL/FBO) end-to-end readback proof.
//! - `achievements`: the W370 RetroAchievements per-frame evaluation loop,
//!   end to end through the real `NativeRuntime` (scripted-memory unlock,
//!   and the no-set-loaded no-op case).

mod achievements;
mod alt_geometry;
mod av_core;
mod cohort;
mod hw_render;
mod input_probe;
