//! Manual, real-device verification harness for the v0.21 "Bedrock"
//! stop-and-reassess point ("is native audio actually clean?" —
//! release-planning-v0.21.md §3), kept meaningful for W270 (pacing/resampler
//! rework) by-ear checks. Not run by `cargo test` (`#[ignore]`); run it
//! explicitly once a core + ROM are available:
//!
//! ```text
//! HARMONY_MANUAL_AUDIO_CORE=/path/to/fceumm_libretro.dylib \
//! HARMONY_MANUAL_AUDIO_ROM=/path/to/game.nes \
//! cargo test --release manual_play_produces_audible_output -- --ignored --nocapture
//! ```

use super::NativeRuntime;
use std::path::PathBuf;
use std::time::Duration;

#[test]
#[ignore]
fn manual_play_produces_audible_output() {
    let core_path = std::env::var("HARMONY_MANUAL_AUDIO_CORE")
        .expect("set HARMONY_MANUAL_AUDIO_CORE to an installed fceumm_libretro.dylib path");
    let rom_path = std::env::var("HARMONY_MANUAL_AUDIO_ROM")
        .expect("set HARMONY_MANUAL_AUDIO_ROM to a real .nes ROM path");

    let runtime = NativeRuntime::start(
        &PathBuf::from(core_path),
        &PathBuf::from(rom_path),
        None,
        None,
    )
    .expect("native runtime failed to start");

    println!("playing for 5s — listen for cold-start garble (#15) and speed/pitch (W270)...");
    std::thread::sleep(Duration::from_secs(5));
    let frame = runtime.latest_frame();
    println!(
        "latest frame present: {}",
        frame
            .map(|(seq, f)| format!("{}x{} (seq {seq})", f.width, f.height))
            .unwrap_or_else(|| "none".into())
    );
    drop(runtime);
}

/// W345's on-device acceptance criterion ("an N64 ROM boots and renders
/// through the native host on device") — the real-hardware counterpart
/// to the headless HW-render stub-core proof
/// (`tests::hw_render::native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels`),
/// which proves the FBO/readback plumbing but necessarily uses a fake
/// core, not real N64 emulation. Not run by `cargo test` (`#[ignore]`);
/// run it explicitly once mupen64plus_next is installed and a ROM is
/// available:
///
/// ```text
/// RGP_N64_CORE=/path/to/mupen64plus_next_libretro.dylib \
/// RGP_N64_ROM=/path/to/game.z64 \
/// cargo test --release manual_n64_boots_and_renders_via_hw_render -- --ignored --nocapture
/// ```
#[test]
#[ignore]
fn manual_n64_boots_and_renders_via_hw_render() {
    let core_path = std::env::var("RGP_N64_CORE")
        .expect("set RGP_N64_CORE to an installed mupen64plus_next_libretro.dylib path");
    let rom_path =
        std::env::var("RGP_N64_ROM").expect("set RGP_N64_ROM to a real .z64/.n64 ROM path");

    let runtime = NativeRuntime::start(
        &PathBuf::from(core_path),
        &PathBuf::from(rom_path),
        None,
        None,
    )
    .expect("native runtime failed to start");

    println!("playing for 5s — confirm a real N64 frame renders (HW-render, W345)...");
    std::thread::sleep(Duration::from_secs(5));
    let frame = runtime.latest_frame();
    println!(
        "latest frame present: {}",
        frame
            .as_ref()
            .map(|(seq, f)| format!(
                "{}x{} aspect={:?} (seq {seq})",
                f.width, f.height, f.aspect_ratio
            ))
            .unwrap_or_else(|| "none".into())
    );
    assert!(frame.is_some(), "an N64 session must produce at least one frame");
    drop(runtime);
}
