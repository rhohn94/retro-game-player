//! Headless declared-options probe (W282, core-options-design.md).
//!
//! Loads a libretro core `.dylib` far enough to observe its
//! `RETRO_ENVIRONMENT_SET_VARIABLES` declaration — `load` →
//! `set_environment` → `init` — then tears the core back down without ever
//! loading a ROM. This is the only place outside a real play session that
//! drives [`LibretroCore`]'s lifecycle, and it reuses the same process-global
//! callback plumbing ([`callbacks`]) a live session does.
//!
//! [`probe_declared_options`] itself only ever serializes against *other
//! probe* calls via [`PROBE_LOCK`] — it has no way to know, on its own,
//! whether a live [`crate::play::native::NativeRuntime`] session is using
//! the same process-global sinks right now. A live session's core thread
//! calls `environment`/`video_refresh`/`audio_sample_batch` continuously,
//! and those callbacks look up the sinks fresh on every call
//! ([`callbacks`]'s module doc) — so a probe's `install()`/`uninstall()`
//! running concurrently with a live session would silently reroute the
//! session's calls into the probe's short-lived channels and then rip the
//! sinks out from under it. This actually happened in ordinary usage (not a
//! contrived edge case): `start_native_play` probing while replacing a
//! still-live prior session, and `list_core_options` probing while a
//! TV-preview session was up. Both call sites now close the gap themselves
//! before this module is ever reached: `commands::native_play::
//! start_native_play` tears down (drops+joins) any prior session *while
//! holding the `NativeSession` mutex*, before it ever calls the seeding
//! probe, and `commands::core_options::list_core_options` checks
//! `native_play::is_session_active` and refuses to probe at all
//! (`AppError::Conflict`) while a session is live. This module's contract is
//! therefore: **a probe call is only ever safe to make when the caller has
//! already established no `NativeRuntime` session exists** — `PROBE_LOCK`
//! only ever needed to protect against two concurrent probes, and that
//! remains its sole job.

use crate::error::AppResult;
use crate::play::native::{self, CoreVariable, EnvironmentEvent, LibretroCore};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

/// How long the probe waits for the core to emit its `SET_VARIABLES`
/// declaration during `retro_init`. Generous relative to real cores (this is
/// a synchronous FFI call on the same thread, not IO) — a core that never
/// declares options within this window is treated as "declares none".
const DECLARE_TIMEOUT: Duration = Duration::from_millis(500);

/// Serializes concurrent probe calls with each other — both would otherwise
/// drive the same process-global callback state ([`native::install`]/
/// [`native::uninstall`]) at once, which is inherently single-session by FFI
/// necessity (see `play::native::callbacks`'s module doc). This intentionally
/// does **not** serialize against a live [`crate::play::native::NativeRuntime`]
/// play session — that guarantee now lives at the call sites (see this
/// module's doc comment above): both `commands::native_play::start_native_play`
/// and `commands::core_options::list_core_options` establish "no session is
/// live" *before* ever reaching `probe_declared_options`, so by the time this
/// lock is taken a concurrent live session is already ruled out by
/// construction, not by anything this lock does.
static PROBE_LOCK: Mutex<()> = Mutex::new(());

/// Loads `core_path` far enough to capture its declared option list, then
/// tears it down. Returns an empty `Vec` (not an error) for a core that
/// declares no options at all — that's a legitimate core, not a failure.
pub fn probe_declared_options(core_path: &Path) -> AppResult<Vec<CoreVariable>> {
    let _guard = PROBE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let channels = native::install();
    let mut core = match LibretroCore::load(core_path) {
        Ok(core) => core,
        Err(e) => {
            native::uninstall();
            return Err(e);
        }
    };
    core.set_environment(native::environment);
    if let Err(e) = core.init() {
        native::uninstall();
        return Err(e);
    }
    let declared = drain_declared_options(&channels, DECLARE_TIMEOUT);
    drop(core); // retro_deinit via LibretroCore::drop, before releasing the global sinks
    native::uninstall();
    Ok(declared)
}

/// Drains the environment channel for up to `timeout`, returning the options
/// from the most recent `VariablesDeclared` event seen (a core that declares
/// its list in more than one call is unusual, but "last wins" is the same
/// principle [`native`]'s own pixel-format negotiation uses). Any
/// `Shutdown`/`PixelFormat` event arriving this early (neither is expected
/// before `load_game`, but a core is untrusted input) is ignored — this
/// function's only contract is "what did the core declare".
fn drain_declared_options(
    channels: &native::CallbackChannels,
    timeout: Duration,
) -> Vec<CoreVariable> {
    let mut declared = Vec::new();
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match channels.environment.recv_timeout(remaining) {
            Ok(EnvironmentEvent::VariablesDeclared(vars)) => declared = vars,
            Ok(_) => continue,
            Err(_) => break,
        }
    }
    declared
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use std::process::Command;

    /// A minimal libretro core that declares two options via
    /// `RETRO_ENVIRONMENT_SET_VARIABLES` during `retro_init`, mirroring real
    /// cores (fceumm included) — enough to exercise the probe headlessly.
    const STUB_CORE_WITH_OPTIONS_C: &str = r#"
#include <stddef.h>
#include <stdbool.h>

struct retro_variable { const char *key; const char *value; };
typedef bool (*retro_environment_t)(unsigned cmd, void *data);
typedef void (*retro_video_refresh_t)(const void *data, unsigned width, unsigned height, size_t pitch);
typedef size_t (*retro_audio_sample_batch_t)(const short *data, size_t frames);
typedef void (*retro_input_poll_t)(void);
typedef short (*retro_input_state_t)(unsigned port, unsigned device, unsigned index, unsigned id);
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

static retro_environment_t env_cb = 0;

static struct retro_variable OPTIONS[] = {
    { "stub_region", "Region; ntsc|pal" },
    { "stub_sprite_limit", "Sprite Limit; enabled|disabled" },
    { 0, 0 },
};

void retro_init(void) {
    env_cb(16 /* RETRO_ENVIRONMENT_SET_VARIABLES */, OPTIONS);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }
void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Options Core";
    info->library_version = "1.0";
    info->valid_extensions = "nes";
    info->need_fullpath = false;
    info->block_extract = false;
}
void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 256; info->geometry.base_height = 240;
    info->geometry.max_width = 256; info->geometry.max_height = 240;
    info->geometry.aspect_ratio = 0.0f;
    info->timing.fps = 60.0; info->timing.sample_rate = 44100.0;
}
void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) {}
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}
bool retro_load_game(const struct retro_game_info *game) { return true; }
void retro_unload_game(void) {}
void retro_run(void) {}
size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

    /// Mirrors `host.rs`'s own `build_stub_core` helper (kept local rather
    /// than shared — the two stub sources diverge, and this is a small,
    /// self-contained test fixture).
    fn build_stub_core(dir: &Path) -> Option<std::path::PathBuf> {
        let c_path = dir.join("stub_options_core.c");
        std::fs::write(&c_path, STUB_CORE_WITH_OPTIONS_C).ok()?;
        let dylib_path = dir.join("stub_options_core.dylib");
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
    fn probe_captures_the_declared_option_list() {
        // The probe drives the same process-global FFI callback state as
        // `play::native::callbacks`'s own tests (see that module's doc) —
        // share its lock so the two suites never race `install`/`uninstall`.
        let _guard = native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let declared = probe_declared_options(&dylib).expect("probe succeeds");
        assert_eq!(declared.len(), 2);
        assert_eq!(declared[0].key, "stub_region");
        assert_eq!(declared[0].description, "Region");
        assert_eq!(declared[0].choices, vec!["ntsc", "pal"]);
        assert_eq!(declared[1].key, "stub_sprite_limit");
        assert_eq!(declared[1].choices, vec!["enabled", "disabled"]);
    }

    #[test]
    fn probe_on_a_missing_path_is_a_dependency_error() {
        let _guard = native::lock_tests();
        let err = probe_declared_options(Path::new("/nonexistent/core.dylib"))
            .expect_err("missing file must error");
        assert!(matches!(err, AppError::Dependency(_)));
    }

    #[test]
    fn probe_leaves_no_seeded_state_behind_for_the_next_session() {
        let _guard = native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        probe_declared_options(&dylib).expect("probe succeeds");
        // uninstall() was called at the end of the probe — a stray GET_VARIABLE
        // query right after must see no seeded variables (proving the probe
        // didn't leak CORE_VARIABLES state into whatever runs next).
        assert!(native::install().environment.try_recv().is_err());
        native::uninstall();
    }
}
