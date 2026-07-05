//! W340 acceptance: "a second software-rendered system boots through the
//! same host in a test with a stub core reporting non-NES geometry/timing."

use crate::play::native::runtime::NativeRuntime;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// W340 acceptance: "a second software-rendered system boots through the
/// same host in a test with a stub core reporting non-NES
/// geometry/timing." A stub core deliberately shaped nothing like NES
/// (8x6 pixels vs. 256x240, 50 fps vs. ~60.0988, 22050 Hz vs. 48000+) —
/// if `NativeRuntime`/`run_core_loop` had any hard-coded NES assumption
/// left over (a fixed frame size, a fixed pacing period, a fixed sample
/// rate), this stub's frames/pacing would be wrong. Everything here comes
/// from the same `NativeRuntime::start` entrypoint and the same
/// `retro_get_system_av_info` read path real cores use — no
/// system-specific branch anywhere in the host.
const STUB_ALT_GEOMETRY_CORE_C: &str = r#"
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
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Alt-Geometry Core";
    info->library_version = "1.0";
    info->valid_extensions = "alt";
    info->need_fullpath = false;
    info->block_extract = false;
}

/* Deliberately unlike NES's 256x240 @ ~60.0988 fps / 48000+ Hz: an 8x6
 * frame at 50 fps and 22050 Hz — a second, differently-shaped
 * software-rendered "system" hosted through the exact same pipeline. */
void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 8;
    info->geometry.base_height = 6;
    info->geometry.max_width = 8;
    info->geometry.max_height = 6;
    info->geometry.aspect_ratio = 4.0f / 3.0f;
    info->timing.fps = 50.0;
    info->timing.sample_rate = 22050.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) { return true; }
void retro_unload_game(void) {}

void retro_run(void) {
    unsigned short buf[48]; /* 8x6 */
    for (int i = 0; i < 48; i++) buf[i] = (unsigned short)((i * 29 + tick * 7 + 1) & 0xFFFF);
    if (video_cb) video_cb(buf, 8, 6, 16);
    tick++;
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

fn build_stub_alt_geometry_core(dir: &Path) -> Option<PathBuf> {
    let c_path = dir.join("stub_alt_geometry_core.c");
    std::fs::write(&c_path, STUB_ALT_GEOMETRY_CORE_C).ok()?;
    let dylib_path = dir.join("stub_alt_geometry_core.dylib");
    let status = Command::new("cc")
        .arg("-dynamiclib")
        .arg("-o")
        .arg(&dylib_path)
        .arg(&c_path)
        .status()
        .ok()?;
    status.success().then_some(dylib_path)
}

#[test]
fn native_runtime_hosts_a_non_nes_geometry_and_timing_stub() {
    let _guard = crate::play::native::lock_tests();
    let dir = tempfile::tempdir().expect("tempdir");
    let Some(dylib) = build_stub_alt_geometry_core(dir.path()) else {
        eprintln!("skipping: no C toolchain on PATH");
        return;
    };
    let rom_path = dir.path().join("game.alt");
    std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

    let runtime = NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut first_frame = None;
    while Instant::now() < deadline {
        if let Some((seq, frame)) = runtime.latest_frame() {
            first_frame = Some((seq, frame));
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let (_seq, frame) = first_frame.expect("a real frame must be produced within the deadline");

    // The frame pipe carries the core's own geometry end to end, not a
    // fixed NES-shaped buffer — 8x6 RGBA8888 (4 bytes/pixel).
    assert_eq!((frame.width, frame.height), (8, 6));
    assert_eq!(frame.data.len(), 8 * 6 * 4);
    assert!(frame.data.iter().any(|&b| b != 0), "frame must not be blank");

    // Timing: at 50 fps (vs. NES's ~60.0988), the number of run-loop
    // ticks inside a fixed window discriminates which rate the loop paces
    // at. The stub emits exactly one video frame per `retro_run` and the
    // loop drains once per tick, so the frame sequence number is a tick
    // counter. The window is anchored on our own two `latest_frame`
    // reads (startup/setup time never leaks into it), and both bounds
    // scale with the *measured* window so scheduler jitter in the sleep
    // itself cannot skew the expectation.
    let (seq_before, _) = runtime.latest_frame().expect("first frame already observed");
    let window_start = Instant::now();
    std::thread::sleep(Duration::from_secs(1)); // ~50 ticks at 50 fps, ~60 at NES rate
    let (seq_after, _) = runtime.latest_frame().expect("frames must still be flowing");
    let elapsed = window_start.elapsed().as_secs_f64();
    let ticks = seq_after.wrapping_sub(seq_before);
    let expected_at_50 = elapsed * 50.0;
    let expected_at_nes = elapsed * 60.0988;
    // Generous lower bound (CI scheduler stalls, ±1-tick read
    // quantization at each end) that still requires ~50 Hz progress...
    assert!(
        ticks as f64 >= expected_at_50 * 0.7,
        "expected ~{expected_at_50:.1} ticks at 50 fps over {elapsed:.3}s, got {ticks}"
    );
    // ...and an upper bound at the midpoint between the two candidate
    // rates: a loop wrongly hard-coded to NES's ~60.0988 fps would
    // produce ~{expected_at_nes:.1} ticks and overshoot it.
    assert!(
        (ticks as f64) < (expected_at_50 + expected_at_nes) / 2.0,
        "tick rate looks like NES ~60.0988 fps, not the stub's declared 50 fps: \
         {ticks} ticks in {elapsed:.3}s (50 fps ≈ {expected_at_50:.1}, \
         60.0988 fps ≈ {expected_at_nes:.1})"
    );

    drop(runtime); // stops + joins both threads
}
