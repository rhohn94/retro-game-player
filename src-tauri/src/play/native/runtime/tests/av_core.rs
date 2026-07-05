//! The baseline stub-core family: proves genuine video + audio content flows
//! end to end, both at the raw FFI layer and through the real
//! [`NativeRuntime::start`] entrypoint, plus the multi-port
//! controller-announce coverage (W350) that reuses the same stub.

use crate::play::native::callbacks;
use crate::play::native::ffi::RETRO_DEVICE_JOYPAD;
use crate::play::native::host::LibretroCore;
use crate::play::native::runtime::session::bring_up_core;
use crate::play::native::runtime::NativeRuntime;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// A minimal libretro core that — unlike `host.rs`'s lifecycle-only stub —
/// actually drives real video + audio output on every `retro_run`, so a
/// full [`NativeRuntime`] session run against it produces genuine,
/// checkable frames and samples:
///   * `retro_video_refresh` is called with a real 4x4 RGB565 buffer whose
///     bytes are NOT all zero/uniform (a blank/all-black frame would pass
///     an `is_some()` check but not prove real content made it through).
///   * `retro_audio_sample_batch` is called with a real, non-silent
///     interleaved-stereo `i16` batch (a 440 Hz-ish deterministic pattern),
///     so "audio samples are genuinely produced" is checkable, not assumed.
const STUB_AV_CORE_C: &str = r#"
#include <stddef.h>
#include <stdbool.h>

struct retro_system_info {
    const char *library_name;
    const char *library_version;
    const char *valid_extensions;
    bool need_fullpath;
    bool block_extract;
};
struct retro_game_geometry { unsigned base_width, base_height, max_width, max_height; float aspect_ratio; };
struct retro_system_timing { double fps, sample_rate; };
struct retro_system_av_info { struct retro_game_geometry geometry; struct retro_system_timing timing; };
struct retro_game_info { const char *path; const void *data; size_t size; const char *meta; };

typedef bool (*retro_environment_t)(unsigned cmd, void *data);
typedef void (*retro_video_refresh_t)(const void *data, unsigned width, unsigned height, size_t pitch);
typedef size_t (*retro_audio_sample_batch_t)(const short *data, size_t frames);
typedef void (*retro_input_poll_t)(void);
typedef short (*retro_input_state_t)(unsigned port, unsigned device, unsigned index, unsigned id);

static retro_environment_t env_cb = 0;
static retro_video_refresh_t video_cb = 0;
static retro_audio_sample_batch_t audio_cb = 0;
static int tick = 0;

void retro_init(void) {
    bool can_dupe = false;
    env_cb(3 /* RETRO_ENVIRONMENT_GET_CAN_DUPE */, &can_dupe);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub AV Core";
    info->library_version = "1.0";
    info->valid_extensions = "nes";
    info->need_fullpath = false;
    info->block_extract = false;
}

void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 4;
    info->geometry.base_height = 4;
    info->geometry.max_width = 4;
    info->geometry.max_height = 4;
    info->geometry.aspect_ratio = 0.0f;
    info->timing.fps = 60.0;
    info->timing.sample_rate = 44100.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) { audio_cb = cb; }
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) {
    return true;
}

void retro_unload_game(void) {}

/* RGB565: 4x4 pixels, 2 bytes each. Non-uniform + non-zero so a test can
 * prove real varying pixel content arrived, not a blank/zeroed buffer. Audio:
 * 64 interleaved stereo i16 frames of a simple non-silent deterministic
 * pattern (never all-zero), so a test can prove real sample content arrived. */
void retro_run(void) {
    unsigned short frame_buf[16];
    for (int i = 0; i < 16; i++) {
        frame_buf[i] = (unsigned short)((i * 37 + tick * 11 + 1) & 0xFFFF);
    }
    if (video_cb) video_cb(frame_buf, 4, 4, 8);

    short audio_buf[128]; /* 64 frames * 2 channels */
    for (int i = 0; i < 64; i++) {
        short sample = (short)(((i * 257) % 2000) - 1000 + tick);
        audio_buf[i * 2] = sample;
        audio_buf[i * 2 + 1] = (short)(-sample);
    }
    if (audio_cb) audio_cb(audio_buf, 64);

    tick++;
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

/// Minimal environment callback for lifecycle bring-up — mirrors
/// `host.rs`'s own `test_environment`.
unsafe extern "C" fn test_environment(_cmd: u32, _data: *mut std::os::raw::c_void) -> bool {
    false
}

/// Compiles [`STUB_AV_CORE_C`] to a `.dylib` in `dir`. `None` (skip, not
/// fail) with no C toolchain on `PATH` — same environment-independence
/// posture as every other stub-core test in this crate.
fn build_stub_av_core(dir: &Path) -> Option<PathBuf> {
    let c_path = dir.join("stub_av_core.c");
    std::fs::write(&c_path, STUB_AV_CORE_C).ok()?;
    let dylib_path = dir.join("stub_av_core.dylib");
    let status = Command::new("cc")
        .arg("-dynamiclib")
        .arg("-o")
        .arg(&dylib_path)
        .arg(&c_path)
        .status()
        .ok()?;
    status.success().then_some(dylib_path)
}

/// Drives the raw FFI lifecycle directly (load → set_environment → init →
/// wire callbacks → load_game → run_frame), reading the real
/// [`callbacks::CallbackChannels`] the runtime itself drains from. This is
/// the lowest-level, hardware-independent proof that the native hosting
/// layer genuinely produces both frame and audio content on a real
/// `retro_run` tick — no `cpal`/audio-device dependency, so it is fully
/// deterministic in a headless CI runner.
#[test]
fn a_real_run_frame_tick_produces_genuine_video_and_audio_content() {
    // Shares the crate-wide lock other tests that drive
    // `callbacks::install`/`uninstall` directly already use (host.rs,
    // core_options::probe, commands::native_play) — never race them.
    let _guard = crate::play::native::lock_tests();
    let dir = tempfile::tempdir().expect("tempdir");
    let Some(dylib) = build_stub_av_core(dir.path()) else {
        eprintln!("skipping: no C toolchain on PATH");
        return;
    };

    let channels = callbacks::install();
    let mut core = LibretroCore::load(&dylib).expect("load stub AV core");
    core.set_environment(test_environment);
    core.init().expect("init after set_environment");
    core.set_video_refresh(callbacks::video_refresh);
    core.set_audio_sample_batch(callbacks::audio_sample_batch);

    let rom = dir.path().join("game.nes");
    std::fs::write(&rom, b"fake rom bytes").expect("write rom");
    core.load_game(&rom).expect("load_game");

    core.run_frame().expect("run frame");

    // Genuine video content: real dimensions, real non-zero, non-uniform
    // bytes — proves the frame is actually produced, not a blank/zeroed
    // placeholder that would also satisfy a weaker "is_some()" check.
    let video = channels
        .video
        .recv_timeout(Duration::from_secs(2))
        .expect("a video frame must have been produced");
    assert_eq!((video.width, video.height, video.pitch), (4, 4, 8));
    assert_eq!(video.data.len(), 32); // 4x4 @ 2 bytes/pixel (RGB565)
    assert!(video.data.iter().any(|&b| b != 0), "frame must not be blank");
    let all_same = video.data.windows(2).all(|w| w[0] == w[1]);
    assert!(!all_same, "frame must carry varying pixel content");

    // Genuine audio content: real sample count, real non-silent values —
    // proves audio samples are actually produced, not an empty/silent
    // batch that would also satisfy a weaker "no error" check.
    let audio = channels
        .audio
        .recv_timeout(Duration::from_secs(2))
        .expect("an audio batch must have been produced");
    assert_eq!(audio.samples.len(), 128); // 64 frames * 2 channels
    assert!(
        audio.samples.iter().any(|&s| s != 0),
        "audio batch must not be silent"
    );

    core.unload_game();
    drop(core);
    callbacks::uninstall();
}

/// End-to-end proof through the real public [`NativeRuntime::start`]
/// entrypoint (not the raw FFI lifecycle above) — the same constructor
/// `commands::native_play::start_native_play` calls in production,
/// spawning the real core thread (and, best-effort, the real audio
/// thread) and letting the run loop tick on its own `FrameClock`. Asserts
/// [`NativeRuntime::latest_frame`] genuinely returns fresh, real pixel
/// data across multiple polls — the actual IPC-facing observable the
/// frontend's frame poller depends on — proving the full stack (FFI core
/// → callbacks → runtime frame conversion → the shared frame slot) works
/// headlessly end-to-end, not just that `start()` returns `Ok`.
#[test]
fn native_runtime_start_produces_polling_real_frames() {
    let _guard = crate::play::native::lock_tests();
    let dir = tempfile::tempdir().expect("tempdir");
    let Some(dylib) = build_stub_av_core(dir.path()) else {
        eprintln!("skipping: no C toolchain on PATH");
        return;
    };
    let rom_path = dir.path().join("game.nes");
    std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

    let runtime = NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");

    // Poll until a real frame lands (the core thread runs asynchronously
    // on its own FrameClock) — generous relative to a 60 fps core tick,
    // tight enough that a genuinely broken pipeline still fails fast.
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut first_frame = None;
    while Instant::now() < deadline {
        if let Some((seq, frame)) = runtime.latest_frame() {
            first_frame = Some((seq, frame));
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let (first_seq, first_frame) =
        first_frame.expect("a real frame must be produced within the deadline");
    assert_eq!((first_frame.width, first_frame.height), (4, 4));
    // RGBA8888: 4 bytes/pixel, 4x4 = 64 bytes.
    assert_eq!(first_frame.data.len(), 64);
    assert!(
        first_frame.data.iter().any(|&b| b != 0),
        "converted RGBA frame must not be blank"
    );

    // The sequence number must keep advancing — proves the runtime is
    // continuously producing NEW frames, not replaying one static buffer.
    std::thread::sleep(Duration::from_millis(200));
    let (later_seq, _) = runtime
        .latest_frame()
        .expect("a frame must still be available");
    assert!(
        later_seq > first_seq,
        "sequence number must advance as new frames are produced (first={first_seq}, later={later_seq})"
    );

    drop(runtime); // stops + joins both threads
}

/// W350 pre-merge review follow-up: direct multi-port coverage of
/// [`bring_up_core`]'s announce loop itself — not just
/// `LibretroCore::set_controller_port_device` in isolation, which
/// `host.rs`'s own tests already cover. Drives the real `bring_up_core`
/// against the shared port-aware stub (which records EVERY announce call,
/// not just the last) and asserts every hosted port was announced as
/// `RETRO_DEVICE_JOYPAD`, in port order, all after `retro_load_game`.
#[test]
fn bring_up_core_announces_a_joypad_on_every_hosted_port_after_load() {
    use crate::play::native::host::test_support::{
        build_stub_port_aware_core, decode_announce_probe,
    };
    let _guard = crate::play::native::lock_tests();
    let dir = tempfile::tempdir().expect("tempdir");
    let Some(dylib) = build_stub_port_aware_core(dir.path()) else {
        eprintln!("skipping: no C toolchain on PATH");
        return;
    };
    let rom_path = dir.path().join("game.nes");
    std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

    let _channels = callbacks::install();
    let result = match bring_up_core(&dylib, &rom_path, &None) {
        Ok(result) => result,
        Err(e) => {
            callbacks::uninstall();
            panic!("bring_up_core must succeed against the port-aware stub: {e}");
        }
    };
    let probe = decode_announce_probe(
        &result.core.sram().expect("stub exposes its announce log via sram()"),
    );
    drop(result);
    callbacks::uninstall();

    let expected: Vec<(u32, u32)> = (0..callbacks::NUM_NATIVE_INPUT_PORTS as u32)
        .map(|port| (port, RETRO_DEVICE_JOYPAD))
        .collect();
    assert_eq!(
        probe.calls, expected,
        "every hosted port must be announced as a joypad, in port order"
    );
    assert_eq!(
        probe.calls_before_load, 0,
        "the announce loop must only run after retro_load_game"
    );
}
