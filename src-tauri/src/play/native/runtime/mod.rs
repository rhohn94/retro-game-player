//! Orchestrates a native core session across two dedicated threads: the
//! **core thread** loads a `LibretroCore`, wires up `callbacks`, and
//! calls `retro_run` on an absolute-deadline frame clock, draining video
//! into a latest-frame-wins slot and audio through the resampler + rate
//! control chain into a lock-free ring; the **audio thread** owns the
//! `cpal::Stream` (which is not `Send`/`Sync`) and drains that ring in its
//! realtime callback. The pacing/resampling/ring mechanics live in
//! `super::clock` and `super::audio`; this module only wires them to the
//! core lifecycle. W212 + W270 — see
//! docs/design/native-emulation-design.md §2.
//!
//! Split into submodules along the runtime's internal seams (W363,
//! v0.36 "Spring Cleaning" — pure-move refactor of the pre-split
//! single-file `runtime.rs`, no logic changes):
//! - `session`: the public [`NativeRuntime`] handle, its thread bring-up
//!   (core + audio), and the save/load/pause/volume IPC-facing surface.
//! - `core_loop`: `CoreLoop`'s per-tick state and `run_core_loop`'s
//!   drive loop, plus the save/load-state and SRAM-flush helpers it calls
//!   between frames.
//! - `video`: draining queued video frames (or an HW-render FBO readback)
//!   into the shared latest-frame slot, and the environment-event drain
//!   (pixel format / geometry / HW-render bring-up) that feeds it.
//! - `audio`: draining queued core audio batches through the resampler
//!   into the realtime ring.
//! - `perf`: the periodic `[rgp-native] perf:` line (effective fps, ring
//!   fill, underrun/overrun, frame-time percentiles).
//!
//! See docs/design/native-emulation-design.md §Module layout for the full
//! map (added alongside this split).

mod audio;
mod core_loop;
mod perf;
mod session;
mod video;

pub use session::NativeRuntime;

#[cfg(test)]
mod tests;

/// Manual, real-device verification harness for the v0.21 "Bedrock"
/// stop-and-reassess point ("is native audio actually clean?" —
/// release-planning-v0.21.md §3), kept meaningful for W270 (pacing/resampler
/// rework) by-ear checks. Not run by `cargo test` (`#[ignore]`); run it
/// explicitly once a core + ROM are available — see the module's own doc.
#[cfg(test)]
mod manual;
