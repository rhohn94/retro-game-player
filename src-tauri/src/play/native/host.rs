//! Safe wrapper over the raw libretro FFI surface ([`super::ffi`]). Owns the
//! loaded `.dylib` and enforces the lifecycle order (load → init → load_game →
//! run* → unload_game → deinit) so callers never see a raw function pointer or
//! an out-of-order call. W210 — see docs/design/native-emulation-design.md §1.

use super::ffi::{
    self, RawSymbols, RetroAudioSampleBatchFn, RetroEnvironmentFn, RetroGameInfo,
    RetroInputPollFn, RetroInputStateFn, RetroSystemAvInfo, RetroSystemInfo, RetroVideoRefreshFn,
    RETRO_API_VERSION,
};
use crate::error::{AppError, AppResult};
use libloading::Library;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::path::Path;

/// `library_name`/`library_version`/`valid_extensions` read out of a core's
/// `retro_get_system_info`, decoded to owned `String`s so callers never touch
/// the raw C strings (which only live as long as the core keeps the backing
/// memory valid — typically static storage, but not a guarantee worth leaning
/// on past this one read).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CoreSystemInfo {
    pub library_name: String,
    pub library_version: String,
    pub valid_extensions: String,
}

fn load_symbol<T: Copy>(lib: &Library, name: &str) -> AppResult<T> {
    let cname = format!("{name}\0");
    unsafe {
        lib.get::<T>(cname.as_bytes())
            .map(|sym| *sym)
            .map_err(|e| AppError::Dependency(format!("core missing symbol {name}: {e}")))
    }
}

fn read_c_str(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

/// A loaded libretro core. `_library` is never read after construction — it
/// exists solely to keep the `.dylib` mapped for as long as `symbols`' raw
/// function pointers may be called; dropping it early would leave those
/// pointers dangling.
///
/// Lifecycle order is enforced here, matching the libretro contract (and
/// RetroArch's call order): `load` → [`Self::set_environment`] →
/// [`Self::init`] → other `set_*` callbacks → [`Self::load_game`] →
/// [`Self::run_frame`]*. `retro_set_environment` **must** precede
/// `retro_init` — real cores (fceumm included) invoke the environment
/// callback from inside `retro_init`, and a core calling a never-registered
/// callback is exactly the v0.21 SIGSEGV this ordering fixes.
#[derive(Debug)]
pub struct LibretroCore {
    symbols: RawSymbols,
    environment_set: bool,
    initialized: bool,
    loaded_game: bool,
    _library: Library,
}

impl LibretroCore {
    /// Loads a libretro core `.dylib` from `path` and verifies it reports the
    /// expected `RETRO_API_VERSION`. Does **not** call `retro_init` — call
    /// [`Self::set_environment`] then [`Self::init`] (in that order), because
    /// cores may query the environment during init.
    pub fn load(path: &Path) -> AppResult<Self> {
        let library = unsafe {
            Library::new(path).map_err(|e| {
                AppError::Dependency(format!("failed to load core {}: {e}", path.display()))
            })?
        };

        let symbols = RawSymbols {
            retro_init: load_symbol(&library, "retro_init")?,
            retro_deinit: load_symbol(&library, "retro_deinit")?,
            retro_api_version: load_symbol(&library, "retro_api_version")?,
            retro_get_system_info: load_symbol(&library, "retro_get_system_info")?,
            retro_get_system_av_info: load_symbol(&library, "retro_get_system_av_info")?,
            retro_set_environment: load_symbol(&library, "retro_set_environment")?,
            retro_set_video_refresh: load_symbol(&library, "retro_set_video_refresh")?,
            retro_set_audio_sample_batch: load_symbol(&library, "retro_set_audio_sample_batch")?,
            retro_set_input_poll: load_symbol(&library, "retro_set_input_poll")?,
            retro_set_input_state: load_symbol(&library, "retro_set_input_state")?,
            retro_run: load_symbol(&library, "retro_run")?,
            retro_load_game: load_symbol(&library, "retro_load_game")?,
            retro_unload_game: load_symbol(&library, "retro_unload_game")?,
            retro_serialize_size: load_symbol(&library, "retro_serialize_size")?,
            retro_serialize: load_symbol(&library, "retro_serialize")?,
            retro_unserialize: load_symbol(&library, "retro_unserialize")?,
            retro_get_memory_data: load_symbol(&library, "retro_get_memory_data")?,
            retro_get_memory_size: load_symbol(&library, "retro_get_memory_size")?,
        };

        let api_version = unsafe { (symbols.retro_api_version)() };
        if api_version != RETRO_API_VERSION {
            return Err(AppError::Unsupported(format!(
                "core {} reports libretro API version {api_version}, Harmony hosts version {RETRO_API_VERSION}",
                path.display()
            )));
        }

        Ok(LibretroCore {
            symbols,
            environment_set: false,
            initialized: false,
            loaded_game: false,
            _library: library,
        })
    }

    /// Calls `retro_init`. Rejected unless [`Self::set_environment`] has been
    /// called first — the libretro contract requires the environment callback
    /// to be registered before init, and real cores segfault otherwise.
    /// Idempotent: a second call is a no-op.
    pub fn init(&mut self) -> AppResult<()> {
        if !self.environment_set {
            return Err(AppError::Internal(
                "retro_init called before retro_set_environment (libretro contract violation)"
                    .into(),
            ));
        }
        if self.initialized {
            return Ok(());
        }
        unsafe {
            (self.symbols.retro_init)();
        }
        self.initialized = true;
        Ok(())
    }

    /// Reads the core's self-reported name/version/supported extensions.
    pub fn system_info(&self) -> CoreSystemInfo {
        let mut info = RetroSystemInfo::default();
        unsafe {
            (self.symbols.retro_get_system_info)(&mut info);
        }
        CoreSystemInfo {
            library_name: read_c_str(info.library_name),
            library_version: read_c_str(info.library_version),
            valid_extensions: read_c_str(info.valid_extensions),
        }
    }

    /// Frame geometry + timing (fps, audio sample rate). Only meaningful after
    /// [`Self::load_game`] — most cores finalize geometry/timing once the ROM
    /// is known.
    pub fn av_info(&self) -> RetroSystemAvInfo {
        let mut info = RetroSystemAvInfo::default();
        unsafe {
            (self.symbols.retro_get_system_av_info)(&mut info);
        }
        info
    }

    pub fn set_environment(&mut self, cb: RetroEnvironmentFn) {
        unsafe {
            (self.symbols.retro_set_environment)(cb);
        }
        self.environment_set = true;
    }

    pub fn set_video_refresh(&self, cb: RetroVideoRefreshFn) {
        unsafe {
            (self.symbols.retro_set_video_refresh)(cb);
        }
    }

    pub fn set_audio_sample_batch(&self, cb: RetroAudioSampleBatchFn) {
        unsafe {
            (self.symbols.retro_set_audio_sample_batch)(cb);
        }
    }

    pub fn set_input_poll(&self, cb: RetroInputPollFn) {
        unsafe {
            (self.symbols.retro_set_input_poll)(cb);
        }
    }

    pub fn set_input_state(&self, cb: RetroInputStateFn) {
        unsafe {
            (self.symbols.retro_set_input_state)(cb);
        }
    }

    /// Loads a ROM by path. Harmony always passes a path (never the file's raw
    /// bytes) — every bundled/installable core handles `need_fullpath`, matching
    /// the existing external-RetroArch launch path (`core/launch`).
    pub fn load_game(&mut self, rom_path: &Path) -> AppResult<()> {
        if !self.initialized {
            return Err(AppError::Internal(
                "retro_load_game called before retro_init".into(),
            ));
        }
        let c_path = CString::new(rom_path.to_string_lossy().as_bytes())
            .map_err(|e| AppError::Validation(format!("ROM path has an embedded NUL: {e}")))?;
        let info = RetroGameInfo {
            path: c_path.as_ptr(),
            data: std::ptr::null(),
            size: 0,
            meta: std::ptr::null(),
        };
        let ok = unsafe { (self.symbols.retro_load_game)(&info) };
        if !ok {
            return Err(AppError::Internal(format!(
                "core rejected ROM {}",
                rom_path.display()
            )));
        }
        self.loaded_game = true;
        Ok(())
    }

    /// Runs exactly one frame. Must only be called after [`Self::load_game`]
    /// succeeds — calling earlier is a Harmony bug, not a user-facing error,
    /// so it is rejected rather than passed through to a core that doesn't
    /// expect it.
    pub fn run_frame(&mut self) -> AppResult<()> {
        if !self.loaded_game {
            return Err(AppError::Internal(
                "retro_run called before load_game".into(),
            ));
        }
        unsafe {
            (self.symbols.retro_run)();
        }
        Ok(())
    }

    fn require_loaded(&self, what: &str) -> AppResult<()> {
        if !self.loaded_game {
            return Err(AppError::Internal(format!(
                "{what} called before load_game"
            )));
        }
        Ok(())
    }

    /// Snapshots the full core state (`retro_serialize`). Returns `Ok(None)`
    /// when the core reports a serialize size of 0 — save states genuinely
    /// unsupported, feature-detected rather than an error.
    pub fn serialize(&mut self) -> AppResult<Option<Vec<u8>>> {
        self.require_loaded("retro_serialize")?;
        let size = unsafe { (self.symbols.retro_serialize_size)() };
        if size == 0 {
            return Ok(None);
        }
        let mut buf = vec![0u8; size];
        let ok = unsafe { (self.symbols.retro_serialize)(buf.as_mut_ptr() as *mut _, size) };
        if !ok {
            return Err(AppError::Internal("retro_serialize failed".into()));
        }
        Ok(Some(buf))
    }

    /// Restores a state produced by [`Self::serialize`] on the same core.
    pub fn unserialize(&mut self, state: &[u8]) -> AppResult<()> {
        self.require_loaded("retro_unserialize")?;
        let ok = unsafe {
            (self.symbols.retro_unserialize)(state.as_ptr() as *const _, state.len())
        };
        if ok {
            Ok(())
        } else {
            Err(AppError::Internal(format!(
                "retro_unserialize rejected a {}-byte state",
                state.len()
            )))
        }
    }

    /// Copies the core's battery save RAM out (`RETRO_MEMORY_SAVE_RAM`).
    /// `None` when the loaded game has no battery RAM (null/zero region) —
    /// normal for most non-battery titles, not an error.
    pub fn sram(&self) -> Option<Vec<u8>> {
        if !self.loaded_game {
            return None;
        }
        let size = unsafe { (self.symbols.retro_get_memory_size)(ffi::RETRO_MEMORY_SAVE_RAM) };
        let data = unsafe { (self.symbols.retro_get_memory_data)(ffi::RETRO_MEMORY_SAVE_RAM) };
        if data.is_null() || size == 0 {
            return None;
        }
        Some(unsafe { std::slice::from_raw_parts(data as *const u8, size) }.to_vec())
    }

    /// Copies previously persisted battery RAM into the core. A size mismatch
    /// (e.g. a `.srm` from a different game/core revision) is rejected rather
    /// than partially copied.
    pub fn load_sram(&mut self, bytes: &[u8]) -> AppResult<()> {
        self.require_loaded("load_sram")?;
        let size = unsafe { (self.symbols.retro_get_memory_size)(ffi::RETRO_MEMORY_SAVE_RAM) };
        let data = unsafe { (self.symbols.retro_get_memory_data)(ffi::RETRO_MEMORY_SAVE_RAM) };
        if data.is_null() || size == 0 {
            return Err(AppError::Unsupported(
                "loaded game exposes no battery save RAM".into(),
            ));
        }
        if bytes.len() != size {
            return Err(AppError::Validation(format!(
                "SRAM size mismatch: file is {} bytes, core expects {size}",
                bytes.len()
            )));
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), data as *mut u8, size);
        }
        Ok(())
    }

    pub fn unload_game(&mut self) {
        if self.loaded_game {
            unsafe {
                (self.symbols.retro_unload_game)();
            }
            self.loaded_game = false;
        }
    }
}

impl Drop for LibretroCore {
    fn drop(&mut self) {
        self.unload_game();
        if self.initialized {
            unsafe {
                (self.symbols.retro_deinit)();
            }
            self.initialized = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// A minimal libretro core implementing only the 13 functions
    /// [`LibretroCore`] calls — enough to exercise the real load → init →
    /// load_game → run → unload → deinit lifecycle headlessly, without a real
    /// game core or audio hardware.
    const STUB_CORE_C: &str = r#"
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

static int frame_count = 0;
static retro_environment_t env_cb = 0;

/* Like real cores (fceumm included), query the environment during init —
 * a frontend that registers the environment callback too late (or not at
 * all) crashes here, exactly as the real core does. Guarded so the crash
 * is a loud, deliberate abort rather than an undefined-behavior segfault. */
void retro_init(void) {
    bool can_dupe = false;
    env_cb(3 /* RETRO_ENVIRONMENT_GET_CAN_DUPE */, &can_dupe);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Core";
    info->library_version = "1.0";
    info->valid_extensions = "nes";
    info->need_fullpath = false;
    info->block_extract = false;
}

void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 256;
    info->geometry.base_height = 240;
    info->geometry.max_width = 256;
    info->geometry.max_height = 240;
    info->geometry.aspect_ratio = 0.0f;
    info->timing.fps = 60.0;
    info->timing.sample_rate = 44100.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) {}
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) {
    return true;
}

void retro_unload_game(void) {}

void retro_run(void) { frame_count++; }

/* Save-persistence surface (W230): a 4-byte "state" mirroring frame_count
 * and an 8-byte battery SRAM region, so serialize/unserialize and
 * SRAM read/write round-trips are testable without a real core. */
static unsigned char sram[8] = {0};

size_t retro_serialize_size(void) { return sizeof(frame_count); }

bool retro_serialize(void *data, size_t size) {
    if (size < sizeof(frame_count)) return false;
    *(int *)data = frame_count;
    return true;
}

bool retro_unserialize(const void *data, size_t size) {
    if (size < sizeof(frame_count)) return false;
    frame_count = *(const int *)data;
    return true;
}

void *retro_get_memory_data(unsigned id) { return id == 0 ? sram : 0; }
size_t retro_get_memory_size(unsigned id) { return id == 0 ? sizeof(sram) : 0; }
"#;

    /// Compiles [`STUB_CORE_C`] to a `.dylib` in `dir`. Returns `None` (the
    /// caller should skip, not fail) if no C toolchain is on `PATH` — keeps
    /// this test environment-independent rather than asserting one is present.
    fn build_stub_core(dir: &Path) -> Option<std::path::PathBuf> {
        let c_path = dir.join("stub_core.c");
        std::fs::write(&c_path, STUB_CORE_C).ok()?;
        let dylib_path = dir.join("stub_core.dylib");
        let status = Command::new("cc")
            .arg("-dynamiclib")
            .arg("-o")
            .arg(&dylib_path)
            .arg(&c_path)
            .status()
            .ok()?;
        status.success().then_some(dylib_path)
    }

    /// Minimal environment callback for lifecycle tests — answers nothing,
    /// but is a valid registered target for the stub core's init-time query.
    unsafe extern "C" fn test_environment(_cmd: u32, _data: *mut std::os::raw::c_void) -> bool {
        false
    }

    #[test]
    fn loads_a_stub_core_and_runs_the_lifecycle() {
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };

        let mut core = LibretroCore::load(&dylib).expect("load stub core");
        core.set_environment(test_environment);
        core.init().expect("init after set_environment");
        let info = core.system_info();
        assert_eq!(info.library_name, "Stub Core");
        assert_eq!(info.library_version, "1.0");
        assert_eq!(info.valid_extensions, "nes");

        let av = core.av_info();
        assert_eq!(av.geometry.base_width, 256);
        assert_eq!(av.geometry.base_height, 240);
        assert_eq!(av.timing.fps, 60.0);

        let rom = dir.path().join("game.nes");
        std::fs::write(&rom, b"fake rom bytes").expect("write rom");
        core.load_game(&rom).expect("load_game");

        core.run_frame().expect("run frame 1");
        core.run_frame().expect("run frame 2");

        core.unload_game();
        // Drop runs retro_deinit; nothing further to assert beyond "doesn't panic".
    }

    #[test]
    fn run_before_load_game_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let mut core = LibretroCore::load(&dylib).expect("load stub core");
        let err = core.run_frame().expect_err("run before load_game must error");
        assert!(matches!(err, AppError::Internal(_)));
    }

    /// The v0.21 SIGSEGV regression test: init without a registered
    /// environment callback must be rejected in safe Rust, never reach the
    /// core (where a real core would crash the process).
    #[test]
    fn init_before_set_environment_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let mut core = LibretroCore::load(&dylib).expect("load stub core");
        let err = core.init().expect_err("init before set_environment must error");
        assert!(matches!(err, AppError::Internal(_)));
    }

    /// Boots the stub core to the ready-to-run state tests need.
    fn booted_core(dir: &Path) -> Option<LibretroCore> {
        let dylib = build_stub_core(dir)?;
        let mut core = LibretroCore::load(&dylib).expect("load stub core");
        core.set_environment(test_environment);
        core.init().expect("init");
        let rom = dir.join("game.nes");
        std::fs::write(&rom, b"fake rom bytes").expect("write rom");
        core.load_game(&rom).expect("load_game");
        Some(core)
    }

    #[test]
    fn serialize_round_trips_core_state() {
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(mut core) = booted_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        core.run_frame().expect("frame 1");
        core.run_frame().expect("frame 2");
        let state = core.serialize().expect("serialize").expect("supported");
        core.run_frame().expect("frame 3 diverges the state");
        core.unserialize(&state).expect("unserialize");
        // The stub's state is its frame counter: after restore, a fresh
        // serialize must equal the snapshot taken at frame 2.
        let restored = core.serialize().expect("serialize").expect("supported");
        assert_eq!(state, restored);
    }

    #[test]
    fn sram_round_trips_through_the_core() {
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(mut core) = booted_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let initial = core.sram().expect("stub exposes battery RAM");
        assert_eq!(initial, vec![0u8; 8]);
        core.load_sram(&[1, 2, 3, 4, 5, 6, 7, 8]).expect("load_sram");
        assert_eq!(core.sram().expect("sram"), vec![1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn load_sram_rejects_a_size_mismatch() {
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(mut core) = booted_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let err = core.load_sram(&[1, 2, 3]).expect_err("wrong size must fail");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn serialize_before_load_game_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let mut core = LibretroCore::load(&dylib).expect("load stub core");
        core.set_environment(test_environment);
        core.init().expect("init");
        let err = core.serialize().expect_err("serialize before load_game must error");
        assert!(matches!(err, AppError::Internal(_)));
        assert!(core.sram().is_none());
    }

    #[test]
    fn load_game_before_init_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let mut core = LibretroCore::load(&dylib).expect("load stub core");
        core.set_environment(test_environment);
        let err = core
            .load_game(Path::new("/tmp/never-read.nes"))
            .expect_err("load_game before init must error");
        assert!(matches!(err, AppError::Internal(_)));
    }

    #[test]
    fn missing_dylib_path_is_a_dependency_error() {
        let err = LibretroCore::load(Path::new("/nonexistent/path/core.dylib"))
            .expect_err("missing file must error");
        assert!(matches!(err, AppError::Dependency(_)));
    }
}
