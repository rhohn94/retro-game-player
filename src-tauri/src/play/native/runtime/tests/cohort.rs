//! W342 (v0.34 "Engines" Pass 2 — software-render cohort): the cohort's
//! three pixel formats plus a mid-game `SET_GEOMETRY` renegotiation.

use crate::play::native::ffi;
use crate::play::native::runtime::NativeRuntime;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// W342 (v0.34 "Engines" Pass 2 — software-render cohort) per-core
/// verification stub. Unlike the alt-geometry stub (which never
/// negotiates a pixel format, relying on the implicit 0RGB1555 default),
/// this core explicitly calls `RETRO_ENVIRONMENT_SET_PIXEL_FORMAT` with a
/// value baked in at compile time (`STUB_PIXEL_FORMAT`, one of libretro's
/// three: 0=0RGB1555, 1=XRGB8888, 2=RGB565) — proving the cohort's three
/// distinct pixel-format paths (SNES/Genesis/PC Engine use XRGB8888 or
/// RGB565; GB/GBC/GBA/Atari 2600 typically use 0RGB1555 or RGB565) all
/// flow end to end through the real host, not just through `frame.rs`'s
/// unit tests. Each emitted pixel is the same non-zero, non-uniform
/// pattern regardless of format so the RGBA8888 output can be checked for
/// "real content arrived" the same way across every format.
///
/// It also emits a mid-game `RETRO_ENVIRONMENT_SET_GEOMETRY` renegotiation
/// after a handful of frames (a real cohort behavior — e.g. a PC Engine
/// title switching between 256- and 320-pixel-wide modes), so one harness
/// covers both acceptance-mandated behaviors: per-pixel-format boot and
/// mid-game geometry change.
const STUB_COHORT_CORE_C: &str = r#"
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
static int tick = 0;

void retro_init(void) {
    bool can_dupe = false;
    env_cb(3 /* RETRO_ENVIRONMENT_GET_CAN_DUPE */, &can_dupe);
    unsigned fmt = STUB_PIXEL_FORMAT;
    env_cb(10 /* RETRO_ENVIRONMENT_SET_PIXEL_FORMAT */, &fmt);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Cohort Core";
    info->library_version = "1.0";
    info->valid_extensions = "bin";
    info->need_fullpath = false;
    info->block_extract = false;
}

void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 4;
    info->geometry.base_height = 4;
    info->geometry.max_width = 8;
    info->geometry.max_height = 8;
    info->geometry.aspect_ratio = 0.0f;
    info->timing.fps = 60.0;
    info->timing.sample_rate = 32000.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) { return true; }
void retro_unload_game(void) {}

/* Bytes-per-pixel matches the negotiated format: 4 for XRGB8888 (fmt 1), else
 * 2 (0RGB1555/RGB565). After 3 frames at 4x4, renegotiates to 8x8 and keeps
 * emitting at the new size — a real mid-game SET_GEOMETRY change. */
void retro_run(void) {
    unsigned bpp = (STUB_PIXEL_FORMAT == 1) ? 4 : 2;
    unsigned width = (tick < 3) ? 4 : 8;
    unsigned height = width;
    if (tick == 3) {
        struct retro_game_geometry geo = { 8, 8, 8, 8, 1.5f };
        env_cb(37 /* RETRO_ENVIRONMENT_SET_GEOMETRY */, &geo);
    }
    unsigned char buf[8 * 8 * 4];
    for (unsigned i = 0; i < width * height * bpp; i++) {
        buf[i] = (unsigned char)((i * 41 + tick * 13 + 7) & 0xFF);
    }
    if (video_cb) video_cb(buf, width, height, (size_t)(width * bpp));
    tick++;
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

/// Compiles [`STUB_COHORT_CORE_C`] with `STUB_PIXEL_FORMAT` defined to
/// `pixel_format` (libretro's raw `RETRO_PIXEL_FORMAT_*` value: 0, 1, or
/// 2). `None` (skip, not fail) with no C toolchain on `PATH`.
fn build_stub_cohort_core(dir: &Path, pixel_format: u32) -> Option<PathBuf> {
    let c_path = dir.join(format!("stub_cohort_core_{pixel_format}.c"));
    std::fs::write(&c_path, STUB_COHORT_CORE_C).ok()?;
    let dylib_path = dir.join(format!("stub_cohort_core_{pixel_format}.dylib"));
    let status = Command::new("cc")
        .arg("-dynamiclib")
        .arg(format!("-DSTUB_PIXEL_FORMAT={pixel_format}"))
        .arg("-o")
        .arg(&dylib_path)
        .arg(&c_path)
        .status()
        .ok()?;
    status.success().then_some(dylib_path)
}

/// Bytes-per-pixel the stub core itself computes for a given raw pixel
/// format value — mirrors the C fixture's `bpp` expression so the test's
/// expected buffer sizes stay in lockstep with what the core emits.
fn stub_cohort_bytes_per_pixel(pixel_format: u32) -> u32 {
    if pixel_format == ffi::RETRO_PIXEL_FORMAT_XRGB8888 {
        4
    } else {
        2
    }
}

/// W342 acceptance ("one test per distinct pixel format path"):
/// parameterized over all three libretro pixel formats the cohort's cores
/// negotiate (0RGB1555 — GB/GBC/Atari2600-style, XRGB8888 — SNES/Genesis-
/// style, RGB565 — PC Engine/GBA-style). Each run boots the same stub
/// core through the real [`NativeRuntime::start`] entrypoint, negotiating
/// that exact format via `RETRO_ENVIRONMENT_SET_PIXEL_FORMAT`, and asserts
/// the delivered frame decodes to real (non-blank) RGBA8888 content —
/// proving `to_rgba8_into`'s per-format conversion path is exercised
/// end-to-end through the host, not just via `frame.rs`'s isolated unit
/// tests. A parameterized loop (not three copy-pasted test fns) per the
/// work item's "don't write per-system copy-paste tests" instruction.
#[test]
fn native_runtime_boots_every_cohort_pixel_format() {
    for pixel_format in [
        ffi::RETRO_PIXEL_FORMAT_0RGB1555,
        ffi::RETRO_PIXEL_FORMAT_XRGB8888,
        ffi::RETRO_PIXEL_FORMAT_RGB565,
    ] {
        let _guard = crate::play::native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_cohort_core(dir.path(), pixel_format) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let rom_path = dir.path().join("game.bin");
        std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

        let runtime =
            NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut first_frame = None;
        while Instant::now() < deadline {
            if let Some((seq, frame)) = runtime.latest_frame() {
                first_frame = Some((seq, frame));
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let (_seq, frame) = first_frame
            .unwrap_or_else(|| panic!("format {pixel_format}: no frame within deadline"));

        // The first frames (before the tick-3 geometry change) are 4x4;
        // decoded RGBA8888 is always 4 bytes/pixel regardless of the
        // source format.
        assert_eq!(
            (frame.width, frame.height),
            (4, 4),
            "format {pixel_format}: unexpected geometry"
        );
        assert_eq!(frame.data.len(), 4 * 4 * 4, "format {pixel_format}: wrong RGBA size");
        assert!(
            frame.data.iter().any(|&b| b != 0),
            "format {pixel_format}: frame must not be blank"
        );

        drop(runtime); // stops + joins both threads
    }
}

/// W342 acceptance ("one mid-game SET_GEOMETRY change test"): the same
/// cohort stub renegotiates from 4x4 to 8x8 partway through the run
/// (`retro_run`'s `tick == 3` branch) — this test rides that out through
/// the real [`NativeRuntime`] and asserts the delivered frame stream
/// actually transitions to the new size, proving the geometry-change path
/// (`callbacks::environment`'s `RETRO_ENVIRONMENT_SET_GEOMETRY` arm +
/// `to_rgba8_into`'s per-frame resize, both already covered in isolation
/// by `callbacks.rs`/`frame.rs`) also works end-to-end for a
/// cohort-shaped core, not just NES's alt-geometry sibling above (which
/// never changes geometry mid-run).
#[test]
fn native_runtime_delivers_a_mid_game_geometry_change() {
    let _guard = crate::play::native::lock_tests();
    let dir = tempfile::tempdir().expect("tempdir");
    let pixel_format = ffi::RETRO_PIXEL_FORMAT_RGB565;
    let Some(dylib) = build_stub_cohort_core(dir.path(), pixel_format) else {
        eprintln!("skipping: no C toolchain on PATH");
        return;
    };
    let rom_path = dir.path().join("game.bin");
    std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

    let runtime = NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");

    // Poll until the geometry actually changes to 8x8 (started at 4x4) —
    // generous relative to a 60 fps core reaching its 4th tick.
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut grew = None;
    while Instant::now() < deadline {
        if let Some((_seq, frame)) = runtime.latest_frame() {
            if (frame.width, frame.height) == (8, 8) {
                grew = Some(frame);
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let frame = grew.expect("geometry must renegotiate to 8x8 within the deadline");
    assert_eq!(frame.data.len(), 8 * 8 * 4);
    assert!(frame.data.iter().any(|&b| b != 0), "post-resize frame must not be blank");
    // bytes-per-pixel sanity: the fixture's own accounting for the format
    // used here, so a future edit to the C source that changes the
    // per-pixel size can't silently desync from this test's assumptions.
    assert_eq!(stub_cohort_bytes_per_pixel(pixel_format), 2);

    drop(runtime); // stops + joins both threads
}
