//! Headless declared-options probe (W282, core-options-design.md; extended
//! for `retro_load_game`-stage declarations by W395; hardened against a
//! NULL AV/input callback deref from within that stage by W404, issue #54).
//!
//! Loads a libretro core `.dylib` far enough to observe its
//! `RETRO_ENVIRONMENT_SET_VARIABLES` declaration(s) — `load` →
//! `set_environment` → `init` → `load_game` (a throwaway stub ROM, never a
//! real one the caller chose) — then tears the core back down. This is the
//! only place outside a real play session that drives [`LibretroCore`]'s
//! lifecycle, and it reuses the same process-global callback plumbing
//! ([`callbacks`]) a live session does.
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
use std::os::raw::c_void;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// How long the probe waits for the core to emit its `SET_VARIABLES`
/// declaration during `retro_init` or `retro_load_game`. Generous relative to
/// real cores (this is a synchronous FFI call on the same thread, not IO) — a
/// core that never declares options within this window is treated as
/// "declares none" for that stage.
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
///
/// Some cores only finalize (or add to) their option list once a ROM is
/// loaded — declaring during `retro_load_game` rather than (or in addition
/// to) `retro_init` — so this drives *both* lifecycle stages: `load` →
/// `set_environment` → `init` → [drain] → `load_game` (a throwaway stub ROM,
/// [`StubRomFile`]) → [drain] — then merges whatever was declared at either
/// stage ([`merge_declared_options`]). A core that rejects the stub ROM, or
/// simply declares nothing further at `load_game`, is not a probe failure:
/// the caller still gets whatever `retro_init` already declared, exactly the
/// pre-existing behavior for a core (every native core Harmony hosts today,
/// including `fceumm`) that only ever declares during `retro_init`.
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
    let declared_at_init = drain_declared_options(&channels, DECLARE_TIMEOUT);
    let declared_at_load_game = probe_load_game_declarations(&mut core, &channels);
    let declared = merge_declared_options(declared_at_init, declared_at_load_game);
    drop(core); // retro_deinit via LibretroCore::drop, before releasing the global sinks
    native::uninstall();
    Ok(declared)
}

/// Drives `retro_load_game` with a throwaway stub ROM ([`StubRomFile`]) and
/// drains whatever the core declares in response — the `retro_load_game`
/// half of [`probe_declared_options`]'s two-stage probe. Every failure mode
/// here (the stub ROM failing to write, or the core rejecting it outright via
/// [`LibretroCore::load_game`] returning `Err`) degrades to "nothing further
/// declared" rather than propagating an error: this stage is strictly
/// additive to whatever `retro_init` already captured, and a core that only
/// ever declares during `retro_init` must see no behavior change.
///
/// **W404 follow-up (issue #54) — AV/input callbacks registered before
/// `load_game`.** Mirrors `bring_up_core`'s (`play::native::runtime::session`)
/// registration order so a core that invokes any of these four callbacks from
/// inside `retro_load_game` sees a real function pointer instead of NULL —
/// see core-options-design.md's W404 entry for the full incident writeup.
/// `input_poll`/`input_state` reuse [`native::input_poll`]/
/// [`native::input_state`] directly: both are already no-ops/always-"not
/// pressed" absent real gameplay, and [`native::install`] resets the global
/// joypad state on entry, so there is nothing probe-specific to add.
/// `video_refresh`/`audio_sample_batch` get their own probe-local stubs
/// below instead, since the real callbacks dereference the incoming data and
/// forward it into channels the probe never drains.
fn probe_load_game_declarations(
    core: &mut LibretroCore,
    channels: &native::CallbackChannels,
) -> Vec<CoreVariable> {
    let Ok(stub_rom) = StubRomFile::write() else {
        return Vec::new();
    };
    core.set_video_refresh(probe_video_refresh);
    core.set_audio_sample_batch(probe_audio_sample_batch);
    core.set_input_poll(native::input_poll);
    core.set_input_state(native::input_state);
    if core.load_game(stub_rom.path()).is_err() {
        return Vec::new();
    }
    drain_declared_options(channels, DECLARE_TIMEOUT)
}

/// `retro_video_refresh_t` stub for the probe's `load_game` stage (W404,
/// issue #54) — a no-op, present only so a core that invokes it from inside
/// `retro_load_game` calls a real function pointer instead of NULL. The
/// probe never needs a rendered frame, so unlike the live-session
/// `play::native::callbacks::video_refresh` this drops the data outright
/// rather than forwarding it anywhere.
///
/// # Safety
/// Touches no pointers itself (the incoming `data` is never dereferenced);
/// safe to call unconditionally. Marked `unsafe extern "C"` only to match
/// `retro_video_refresh_t`'s ABI, the contract [`LibretroCore::set_video_refresh`]
/// requires.
unsafe extern "C" fn probe_video_refresh(_data: *const c_void, _width: u32, _height: u32, _pitch: usize) {}

/// `retro_audio_sample_batch_t` stub for the probe's `load_game` stage (W404,
/// issue #54) — see [`probe_video_refresh`]'s doc for why this is a no-op.
/// Reports the full batch consumed, matching the real
/// `play::native::callbacks::audio_sample_batch`'s contract (Harmony has no
/// partial-consume backpressure protocol at this layer).
///
/// # Safety
/// Touches no pointers itself; safe to call unconditionally. Marked
/// `unsafe extern "C"` only to match `retro_audio_sample_batch_t`'s ABI.
unsafe extern "C" fn probe_audio_sample_batch(_data: *const i16, frames: usize) -> usize {
    frames
}

/// Combines the option lists a core declared at its two possible declaration
/// points — `retro_init` (`base`) and `retro_load_game` (`overlay`) — into
/// the single list [`probe_declared_options`] returns. A key declared at both
/// stages keeps its `retro_load_game` variant (the later, post-ROM-analysis
/// declaration is the more informed one — the same "last wins" principle
/// [`drain_declared_options`] already applies *within* one stage, extended
/// across the two); a key declared at only one stage is kept as-is.
/// Declaration order is preserved: every `base` entry stays in its original
/// position (updated in place if `overlay` also declares it), and any
/// `overlay`-only entry is appended in the order the core declared it.
fn merge_declared_options(
    base: Vec<CoreVariable>,
    overlay: Vec<CoreVariable>,
) -> Vec<CoreVariable> {
    let mut merged = base;
    for var in overlay {
        match merged.iter_mut().find(|existing| existing.key == var.key) {
            Some(existing) => *existing = var,
            None => merged.push(var),
        }
    }
    merged
}

/// Drains the environment channel for up to `timeout`, returning the options
/// from the most recent `VariablesDeclared` event seen in that window (a core
/// that declares its list more than once *within the same stage* is unusual,
/// but "last wins" is the same principle [`native`]'s own pixel-format
/// negotiation uses). Any `Shutdown`/`PixelFormat` event arriving this early
/// (none are expected before `run_frame`, but a core is untrusted input) is
/// ignored — this function's only contract is "what did the core declare in
/// this stage".
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

/// A minimal placeholder ROM Harmony writes to a scratch temp path and hands
/// to [`LibretroCore::load_game`] purely so the call has *something* to
/// load. [`probe_declared_options`] runs before the caller has necessarily
/// chosen a real game — `list_core_options` probes from just a `system`, with
/// no ROM in scope — so there is no real ROM available to pass through
/// instead. The bytes are not a valid image for any particular system; a
/// core that validates ROM contents and rejects this stub is expected and
/// handled gracefully (see [`probe_load_game_declarations`]), not treated as
/// a probe failure.
struct StubRomFile {
    path: PathBuf,
}

impl StubRomFile {
    /// A handful of zero bytes — enough for `retro_load_game` to have a file
    /// to open, not intended to resemble any real ROM format. Sized/shaped
    /// around nothing in particular (deliberately not any specific core).
    const CONTENTS: &'static [u8] = &[0u8; 64];

    /// Writes [`Self::CONTENTS`] to a fresh path under the OS temp dir,
    /// unique per call (process id + a monotonic counter) so two probes
    /// never share or clobber one another's file — same-process probes
    /// already serialize on [`PROBE_LOCK`], but this also protects against
    /// two separate Harmony processes probing at the same time.
    fn write() -> std::io::Result<Self> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "harmony-core-options-probe-stub-{}-{unique}.rom",
            std::process::id()
        ));
        std::fs::write(&path, Self::CONTENTS)?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for StubRomFile {
    /// Best-effort cleanup — a failure here (e.g. the file was already
    /// removed by some outside actor) leaves nothing worse than a stray temp
    /// file, not a probe failure.
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
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

    /// Shared builder for this module's stub libretro cores: writes `source`
    /// to `<dir>/<basename>.c` and compiles it to `<dir>/<basename>.dylib`.
    /// The stub cores in this module differ only in their C source and file
    /// basename — this is the one place that knows how to turn either into a
    /// loadable dylib.
    fn build_stub_core_from(dir: &Path, basename: &str, source: &str) -> Option<std::path::PathBuf> {
        let c_path = dir.join(format!("{basename}.c"));
        std::fs::write(&c_path, source).ok()?;
        let dylib_path = dir.join(format!("{basename}.dylib"));
        let status = Command::new("cc")
            .arg("-dynamiclib")
            .arg("-o")
            .arg(&dylib_path)
            .arg(&c_path)
            .status()
            .ok()?;
        status.success().then_some(dylib_path)
    }

    /// Mirrors `host.rs`'s own `build_stub_core` helper (kept local rather
    /// than shared — the two stub sources diverge, and this is a small,
    /// self-contained test fixture).
    fn build_stub_core(dir: &Path) -> Option<std::path::PathBuf> {
        build_stub_core_from(dir, "stub_options_core", STUB_CORE_WITH_OPTIONS_C)
    }

    /// A minimal libretro core that declares its option list only once a
    /// game is "loaded" (`retro_load_game`) rather than during `retro_init`
    /// — the W395/core-options-design.md scenario the probe was previously
    /// blind to: a core whose option list depends on ROM analysis it can
    /// only do once a ROM is loaded. `retro_init` here deliberately never
    /// touches `env_cb`.
    const STUB_CORE_DECLARES_AT_LOAD_GAME_C: &str = r#"
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

static struct retro_variable LOAD_GAME_OPTIONS[] = {
    { "stub_load_game_option", "Load-Game Option; a|b" },
    { 0, 0 },
};

void retro_init(void) {}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }
void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Load-Game-Options Core";
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
bool retro_load_game(const struct retro_game_info *game) {
    env_cb(16 /* RETRO_ENVIRONMENT_SET_VARIABLES */, LOAD_GAME_OPTIONS);
    return true;
}
void retro_unload_game(void) {}
void retro_run(void) {}
size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

    /// Mirrors [`build_stub_core`] but for [`STUB_CORE_DECLARES_AT_LOAD_GAME_C`].
    fn build_stub_core_declaring_at_load_game(dir: &Path) -> Option<std::path::PathBuf> {
        build_stub_core_from(
            dir,
            "stub_load_game_options_core",
            STUB_CORE_DECLARES_AT_LOAD_GAME_C,
        )
    }

    /// A minimal libretro core that declares a *different* option at each of
    /// the two stages — `retro_init` and `retro_load_game` — proving the
    /// probe merges both rather than either stage clobbering the other.
    const STUB_CORE_DECLARES_AT_BOTH_STAGES_C: &str = r#"
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

static struct retro_variable INIT_OPTIONS[] = {
    { "stub_init_option", "Init Option; x|y" },
    { 0, 0 },
};
static struct retro_variable LOAD_GAME_OPTIONS[] = {
    { "stub_load_game_option", "Load-Game Option; a|b" },
    { 0, 0 },
};

void retro_init(void) {
    env_cb(16 /* RETRO_ENVIRONMENT_SET_VARIABLES */, INIT_OPTIONS);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }
void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Both-Stages Options Core";
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
bool retro_load_game(const struct retro_game_info *game) {
    env_cb(16 /* RETRO_ENVIRONMENT_SET_VARIABLES */, LOAD_GAME_OPTIONS);
    return true;
}
void retro_unload_game(void) {}
void retro_run(void) {}
size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

    /// Mirrors [`build_stub_core`] but for [`STUB_CORE_DECLARES_AT_BOTH_STAGES_C`].
    fn build_stub_core_declaring_at_both_stages(dir: &Path) -> Option<std::path::PathBuf> {
        build_stub_core_from(
            dir,
            "stub_both_stages_options_core",
            STUB_CORE_DECLARES_AT_BOTH_STAGES_C,
        )
    }

    /// A minimal libretro core that invokes all four AV/input callbacks
    /// (`video_refresh`, `audio_sample_batch`, `input_poll`, `input_state`)
    /// from *inside* `retro_load_game`, before returning — the W404 (issue
    /// #54) regression scenario: before that fix, none of these four were
    /// registered ahead of the probe's `load_game` stage, so a core doing
    /// this would call through a NULL function pointer and crash. Each
    /// callback is invoked through the pointer the host registered via the
    /// matching `retro_set_*` call, exactly as a real core would; a core
    /// that skips this (like every native core Harmony hosts today,
    /// `fceumm` included) never reaches this code path at all.
    const STUB_CORE_INVOKES_CALLBACKS_AT_LOAD_GAME_C: &str = r#"
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
static retro_video_refresh_t video_cb = 0;
static retro_audio_sample_batch_t audio_cb = 0;
static retro_input_poll_t input_poll_cb = 0;
static retro_input_state_t input_state_cb = 0;

static struct retro_variable LOAD_GAME_OPTIONS[] = {
    { "stub_after_callbacks_option", "After Callbacks; a|b" },
    { 0, 0 },
};

void retro_init(void) {}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }
void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Invokes-Callbacks-At-Load-Game Core";
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
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) { audio_cb = cb; }
void retro_set_input_poll(retro_input_poll_t cb) { input_poll_cb = cb; }
void retro_set_input_state(retro_input_state_t cb) { input_state_cb = cb; }
bool retro_load_game(const struct retro_game_info *game) {
    // Would call through a NULL function pointer (crash) here before W404's
    // fix, since none of the four callbacks below were registered ahead of
    // this call in the probe's load_game stage.
    unsigned char pixel = 0;
    video_cb(&pixel, 1, 1, 1);
    short sample = 0;
    audio_cb(&sample, 1);
    input_poll_cb();
    input_state_cb(0, 0, 0, 0);
    env_cb(16 /* RETRO_ENVIRONMENT_SET_VARIABLES */, LOAD_GAME_OPTIONS);
    return true;
}
void retro_unload_game(void) {}
void retro_run(void) {}
size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

    /// Mirrors [`build_stub_core`] but for
    /// [`STUB_CORE_INVOKES_CALLBACKS_AT_LOAD_GAME_C`].
    fn build_stub_core_invoking_callbacks_at_load_game(dir: &Path) -> Option<std::path::PathBuf> {
        build_stub_core_from(
            dir,
            "stub_invokes_callbacks_at_load_game_core",
            STUB_CORE_INVOKES_CALLBACKS_AT_LOAD_GAME_C,
        )
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

    // ---- W395 (issue #33): retro_load_game-declared options ----

    #[test]
    fn probe_captures_options_declared_only_during_load_game() {
        // Before W395 this returned an empty Vec: the probe never drove
        // load_game at all, so a core that only declares post-ROM-analysis
        // was silently reported as having zero options.
        let _guard = native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core_declaring_at_load_game(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let declared = probe_declared_options(&dylib).expect("probe succeeds");
        assert_eq!(declared.len(), 1);
        assert_eq!(declared[0].key, "stub_load_game_option");
        assert_eq!(declared[0].description, "Load-Game Option");
        assert_eq!(declared[0].choices, vec!["a", "b"]);
    }

    #[test]
    fn probe_merges_options_declared_at_both_stages() {
        // Proves an actual merge, not "whichever stage runs last wins the
        // whole list": both the retro_init-declared and the
        // retro_load_game-declared option must be present together.
        let _guard = native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core_declaring_at_both_stages(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let declared = probe_declared_options(&dylib).expect("probe succeeds");
        assert_eq!(declared.len(), 2);
        assert_eq!(declared[0].key, "stub_init_option");
        assert_eq!(declared[1].key, "stub_load_game_option");
    }

    // ---- W404 (issue #54): AV/input callbacks registered before load_game ----

    #[test]
    fn probe_load_game_declarations_survives_a_core_invoking_av_and_input_callbacks() {
        // Drives probe_load_game_declarations directly, bypassing
        // probe_declared_options entirely — this is the dedicated unit test
        // the W404 acceptance criteria call for, reusing this module's
        // existing stub-core-builder helpers rather than only the pre-existing
        // 2 FFI integration tests that exercise this function transitively.
        //
        // Before W404's fix, `retro_load_game` calling any of
        // video_refresh/audio_sample_batch/input_poll/input_state here would
        // call through a NULL function pointer on the core's C side and crash
        // the whole test process — this test's mere completion (whichever
        // assertion runs) is itself proof of the fix.
        let _guard = native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core_invoking_callbacks_at_load_game(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let channels = native::install();
        let mut core = LibretroCore::load(&dylib).expect("core loads");
        core.set_environment(native::environment);
        core.init().expect("core inits");

        let declared = probe_load_game_declarations(&mut core, &channels);

        drop(core);
        native::uninstall();
        assert_eq!(declared.len(), 1);
        assert_eq!(declared[0].key, "stub_after_callbacks_option");
        assert_eq!(declared[0].description, "After Callbacks");
        assert_eq!(declared[0].choices, vec!["a", "b"]);
    }

    // ---- merge_declared_options (pure, no FFI needed) ----

    fn var(key: &str) -> CoreVariable {
        CoreVariable {
            key: key.into(),
            description: format!("{key} description"),
            choices: vec!["default".into()],
        }
    }

    #[test]
    fn merge_declared_options_is_a_no_op_when_overlay_is_empty() {
        let base = vec![var("a"), var("b")];
        let merged = merge_declared_options(base.clone(), Vec::new());
        assert_eq!(merged, base);
    }

    #[test]
    fn merge_declared_options_appends_disjoint_overlay_keys_in_order() {
        let merged = merge_declared_options(vec![var("a")], vec![var("b"), var("c")]);
        let keys: Vec<&str> = merged.iter().map(|v| v.key.as_str()).collect();
        assert_eq!(keys, vec!["a", "b", "c"]);
    }

    #[test]
    fn merge_declared_options_lets_overlay_win_on_a_shared_key() {
        let base_var = CoreVariable {
            key: "a".into(),
            description: "from init".into(),
            choices: vec!["x".into()],
        };
        let overlay_var = CoreVariable {
            key: "a".into(),
            description: "from load_game".into(),
            choices: vec!["y".into()],
        };
        let merged = merge_declared_options(vec![base_var], vec![overlay_var]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].description, "from load_game");
        assert_eq!(merged[0].choices, vec!["y"]);
    }

    #[test]
    fn merge_declared_options_updates_a_shared_key_in_place_without_reordering() {
        let merged = merge_declared_options(
            vec![var("a"), var("b")],
            vec![CoreVariable {
                key: "a".into(),
                description: "updated".into(),
                choices: vec!["z".into()],
            }],
        );
        let keys: Vec<&str> = merged.iter().map(|v| v.key.as_str()).collect();
        assert_eq!(keys, vec!["a", "b"]);
        assert_eq!(merged[0].description, "updated");
    }

    // ---- StubRomFile ----

    #[test]
    fn stub_rom_file_writes_a_readable_file_and_removes_it_on_drop() {
        let path = {
            let stub = StubRomFile::write().expect("stub rom writes");
            let path = stub.path().to_path_buf();
            assert!(path.exists());
            assert_eq!(std::fs::read(&path).expect("readable"), StubRomFile::CONTENTS);
            path
        };
        assert!(!path.exists(), "dropping StubRomFile must remove its file");
    }

    #[test]
    fn stub_rom_file_writes_produce_distinct_paths() {
        let a = StubRomFile::write().expect("stub rom writes");
        let b = StubRomFile::write().expect("stub rom writes");
        assert_ne!(a.path(), b.path());
    }
}
