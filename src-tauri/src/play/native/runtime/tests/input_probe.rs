//! W350 pre-merge review regression (session-start release-all): a stub core
//! whose first `retro_run` tick probes every hosted port for stale held
//! buttons, proving a fresh session never inherits a prior session's input.

use crate::play::native::callbacks;
use crate::play::native::runtime::NativeRuntime;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// W350 pre-merge review follow-up (session-start release-all): a stub
/// core that polls Harmony's real `input_state` callback on its FIRST
/// `retro_run` tick and encodes what it read into every frame it emits —
/// a black (0x0000, decoded under the un-negotiated 0RGB1555 default)
/// pixel when the first poll read no held buttons on any port, a white
/// (0xFFFF) pixel otherwise. The result is
/// latched at the first tick and re-emitted every frame, so the test's
/// latest-frame-wins poll can observe the first tick's verdict no matter
/// how many frames have elapsed by the time it reads one.
const STUB_INPUT_PROBE_CORE_C: &str = r#"
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
static retro_input_poll_t poll_cb = 0;
static retro_input_state_t input_cb = 0;
static unsigned short first_poll_or = 0;
static int polled = 0;

void retro_init(void) {
    bool can_dupe = false;
    env_cb(3 /* RETRO_ENVIRONMENT_GET_CAN_DUPE */, &can_dupe);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Input-Probe Core";
    info->library_version = "1.0";
    info->valid_extensions = "nes";
    info->need_fullpath = false;
    info->block_extract = false;
}

void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 1;
    info->geometry.base_height = 1;
    info->geometry.max_width = 1;
    info->geometry.max_height = 1;
    info->geometry.aspect_ratio = 0.0f;
    info->timing.fps = 60.0;
    info->timing.sample_rate = 44100.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) { poll_cb = cb; }
void retro_set_input_state(retro_input_state_t cb) { input_cb = cb; }

bool retro_load_game(const struct retro_game_info *game) { return true; }
void retro_unload_game(void) {}

/* First tick: poll every hosted port (and every joypad button id) exactly
 * the way a real core does, OR the answers together, and latch the result.
 * Every tick: emit a 1x1 16-bit frame (the un-negotiated 0RGB1555 default)
 * encoding that latched first-poll verdict — 0x0000 (black) for all-zero,
 * 0xFFFF (white) otherwise. */
void retro_run(void) {
    if (!polled) {
        if (poll_cb) poll_cb();
        if (input_cb) {
            for (unsigned port = 0; port < 2; port++) {
                for (unsigned id = 0; id < 16; id++) {
                    if (input_cb(port, 1 /* RETRO_DEVICE_JOYPAD */, 0, id)) {
                        first_poll_or |= (unsigned short)(1u << id);
                    }
                }
            }
        }
        polled = 1;
    }
    unsigned short px = first_poll_or ? 0xFFFFu : 0x0000u;
    if (video_cb) video_cb(&px, 1, 1, 2);
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

/// Compiles [`STUB_INPUT_PROBE_CORE_C`] to a `.dylib` in `dir`. `None`
/// (skip, not fail) with no C toolchain on `PATH`.
fn build_stub_input_probe_core(dir: &Path) -> Option<PathBuf> {
    let c_path = dir.join("stub_input_probe_core.c");
    std::fs::write(&c_path, STUB_INPUT_PROBE_CORE_C).ok()?;
    let dylib_path = dir.join("stub_input_probe_core.dylib");
    let status = Command::new("cc")
        .arg("-dynamiclib")
        .arg("-o")
        .arg(&dylib_path)
        .arg(&c_path)
        .status()
        .ok()?;
    status.success().then_some(dylib_path)
}

/// W350 pre-merge review regression (session-start release-all): a stray
/// `set_native_input` landing between sessions — the keydown race after a
/// stop; the command is a no-session no-op by design, but its bits still
/// land in the process-global port masks — must NOT leak into the next
/// session as ghost held buttons. Sets both ports' masks with no session
/// running, starts a real stub session through the same
/// [`NativeRuntime::start`] entrypoint production uses, and asserts the
/// core's own FIRST input poll read all-zero (via the probe stub's
/// black-frame encoding). Fails as a white frame if session start ever
/// stops routing through `callbacks`' release-all helper.
#[test]
fn a_fresh_session_reads_all_zero_input_despite_stale_between_session_state() {
    let _guard = crate::play::native::lock_tests();
    let dir = tempfile::tempdir().expect("tempdir");
    let Some(dylib) = build_stub_input_probe_core(dir.path()) else {
        eprintln!("skipping: no C toolchain on PATH");
        return;
    };
    let rom_path = dir.path().join("game.nes");
    std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

    callbacks::uninstall(); // clean slate: no session running
    // The stray between-session keydown, on both ports.
    callbacks::set_joypad_state(u16::MAX, 0);
    callbacks::set_joypad_state(u16::MAX, 1);

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
    let (_seq, frame) = first_frame.expect("a frame must be produced within the deadline");
    assert_eq!((frame.width, frame.height), (1, 1));
    // Black = the core's first poll read all-zero on every port; any
    // non-zero channel means a ghost held button leaked across sessions.
    assert_eq!(
        &frame.data[0..3],
        &[0, 0, 0],
        "the core's first input poll must read all-zero — stale between-session \
         input leaked into the fresh session"
    );

    drop(runtime); // stops + joins both threads
}
