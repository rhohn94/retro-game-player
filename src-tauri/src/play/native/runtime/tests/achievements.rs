//! W370 end-to-end proof through the real [`NativeRuntime`] entrypoint: a
//! stub core exposing `RETRO_MEMORY_SYSTEM_RAM` (id 2), ticked by the real
//! core loop, with a scripted memory change (driven from the core's own
//! `retro_run`, exactly like a real game incrementing a stat) triggering
//! exactly one unlock — proving the full path (core loop → per-frame peek →
//! rcheevos evaluator → bounded unlock channel → `NativeRuntime::drain_unlocks`)
//! works headlessly, not just each layer in isolation.

use crate::play::achievements::{AchievementDefinition, AchievementSet};
use crate::play::native::runtime::NativeRuntime;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

/// A stub core whose system RAM (id 2) starts at 0 and flips to 1 after a
/// fixed number of `retro_run` ticks — standing in for "the player did the
/// thing the achievement watches for" without needing real game logic.
const STUB_ACHIEVEMENT_CORE_C: &str = r#"
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
static int tick = 0;
static unsigned char system_ram[16] = {0};

void retro_init(void) {
    bool can_dupe = false;
    env_cb(3 /* RETRO_ENVIRONMENT_GET_CAN_DUPE */, &can_dupe);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Achievement Core";
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
    /* A fast tick rate keeps the test's wall-clock wait short. */
    info->timing.fps = 240.0;
    info->timing.sample_rate = 44100.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) {}
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) { return true; }
void retro_unload_game(void) {}

/* After 5 ticks, byte 0 of system RAM flips from 0 to 1 — the condition
 * the test's achievement trigger (0xH00=1) watches for. */
void retro_run(void) {
    tick++;
    if (tick >= 5) system_ram[0] = 1;
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }

void *retro_get_memory_data(unsigned id) { return id == 2 ? system_ram : 0; }
size_t retro_get_memory_size(unsigned id) { return id == 2 ? sizeof(system_ram) : 0; }
"#;

/// Compiles [`STUB_ACHIEVEMENT_CORE_C`] to a `.dylib` in `dir`. `None`
/// (skip, not fail) with no C toolchain on `PATH`.
fn build_stub_achievement_core(dir: &Path) -> Option<PathBuf> {
    let c_path = dir.join("stub_achievement_core.c");
    std::fs::write(&c_path, STUB_ACHIEVEMENT_CORE_C).ok()?;
    let dylib_path = dir.join("stub_achievement_core.dylib");
    let status = Command::new("cc")
        .arg("-dynamiclib")
        .arg("-o")
        .arg(&dylib_path)
        .arg(&c_path)
        .status()
        .ok()?;
    status.success().then_some(dylib_path)
}

/// The acceptance criterion, verbatim: "a stub-core test... with a scripted
/// memory value triggers an unlock event exactly once."
#[test]
fn scripted_memory_value_triggers_exactly_one_unlock_end_to_end() {
    let _guard = crate::play::native::lock_tests();
    let dir = tempfile::tempdir().expect("tempdir");
    let Some(dylib) = build_stub_achievement_core(dir.path()) else {
        eprintln!("skipping: no C toolchain on PATH");
        return;
    };
    let rom_path = dir.path().join("game.nes");
    std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

    let runtime = NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");
    runtime
        .load_achievement_set(AchievementSet {
            hash: "test".into(),
            achievements: vec![AchievementDefinition {
                id: 99,
                title: "Flip The Byte".into(),
                trigger: "0xH00=1".into(),
            }],
        })
        .expect("load_achievement_set");

    // Poll until the unlock arrives (the core thread ticks asynchronously
    // on its own FrameClock at 240fps, so 5 ticks is well under 100ms) —
    // generous relative to that, tight enough a genuinely broken pipeline
    // still fails fast.
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut unlocks = Vec::new();
    while Instant::now() < deadline && unlocks.is_empty() {
        unlocks = runtime.drain_unlocks();
        if unlocks.is_empty() {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    assert_eq!(
        unlocks.len(),
        1,
        "exactly one unlock must be produced, got {unlocks:?}"
    );
    assert_eq!(unlocks[0].achievement_id, 99);

    // Draining again after the achievement has long since triggered must
    // yield nothing further — an edge-triggered unlock, not a repeating one.
    std::thread::sleep(Duration::from_millis(100));
    let more = runtime.drain_unlocks();
    assert!(
        more.is_empty(),
        "an already-triggered achievement must not unlock again: {more:?}"
    );

    drop(runtime); // stops + joins both threads
}

/// The acceptance criterion's other half: a session with **no** achievement
/// set loaded must show no measurable frame-loop regression. This test
/// doesn't measure timing directly (the existing `av_core`/`cohort` pacing
/// tests already cover that) — it proves the no-set path is exercised by
/// every ordinary session (nothing extra must be opted into) and produces
/// no spurious unlocks, matching `AchievementRuntime::do_frame`'s
/// single-branch fast path.
#[test]
fn a_session_with_no_achievement_set_loaded_produces_no_unlocks() {
    let _guard = crate::play::native::lock_tests();
    let dir = tempfile::tempdir().expect("tempdir");
    let Some(dylib) = build_stub_achievement_core(dir.path()) else {
        eprintln!("skipping: no C toolchain on PATH");
        return;
    };
    let rom_path = dir.path().join("game.nes");
    std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

    let runtime = NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");
    // Let the stub's byte flip (tick >= 5) happen well within this window —
    // with no set loaded, that memory change must never produce an unlock.
    std::thread::sleep(Duration::from_millis(200));
    let unlocks = runtime.drain_unlocks();
    assert!(
        unlocks.is_empty(),
        "no achievement set loaded ⇒ no unlocks, ever: {unlocks:?}"
    );
    drop(runtime);
}
