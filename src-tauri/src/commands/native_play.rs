//! Native play IPC (v0.21 "Bedrock") — the opt-in feature flag (W215),
//! start/stop a native libretro core session, pull decoded RGBA frames for
//! the frontend's `<canvas>` (W214), and push joypad input into the running
//! core (W216). Mirrors `commands::play`'s shape (in-page EmulatorJS) but for
//! the native hosting path; see docs/design/native-emulation-design.md §3/§4.

use crate::config::{paths::Paths, AppConfig};
use crate::core::core_options;
use crate::db::repo::library::LibraryRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::play::native;
use crate::play::native::Rgba8Frame;
use crate::play::saves::{GameSaves, PlayPath};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Whether native hosting is enabled (`AppConfig::native_play_enabled`,
/// off by default). The frontend's runtime switch (`PlaySwitch.tsx`) is the
/// primary gate, but `start_native_play` re-checks this too — defense in
/// depth against any other caller bypassing the switch.
#[tauri::command]
pub fn get_native_play_enabled() -> AppResult<bool> {
    Ok(AppConfig::load(&Paths::app_support()?)?.native_play_enabled)
}

/// Persists the native-play opt-in.
#[tauri::command]
pub fn set_native_play_enabled(enabled: bool) -> AppResult<()> {
    let paths = Paths::app_support()?;
    let mut config = AppConfig::load(&paths)?;
    config.native_play_enabled = enabled;
    config.save(&paths)
}

/// Holds the single in-flight native session, if any. Harmony only ever
/// plays one game natively at a time; starting a new session replaces (and,
/// via `NativeRuntime`'s `Drop`, stops) whatever was running.
#[derive(Default)]
pub struct NativeSession(Mutex<Option<native::NativeRuntime>>);

fn lock(session: &NativeSession) -> std::sync::MutexGuard<'_, Option<native::NativeRuntime>> {
    session.0.lock().unwrap_or_else(|p| p.into_inner())
}

/// True while a `NativeRuntime` session is held in `session` — i.e. a game is
/// actually booted/running (a preview session counts too; both hold a real
/// `NativeRuntime`). Lets a caller outside this module (`commands::core_options`,
/// W282 race fix) refuse work that would otherwise install the same
/// process-global FFI callback sinks (`play::native::callbacks`) a live
/// session already owns, without exposing the `NativeSession` internals.
pub(crate) fn is_session_active(session: &NativeSession) -> bool {
    lock(session).is_some()
}

/// Resolves the session's side-effect wiring (v0.27 W273): a PREVIEW session
/// (the TV hover-attract spectator surface) must leave no trace, so it drops
/// both the save wiring — `saves: None` structurally disables the SRAM load/
/// flush and the exit auto-save-state in the runtime (`run_core_loop` gates
/// every save touch on `Some`, runtime.rs) — and the perf-log path, so a
/// preview never truncates the last REAL session's `logs/native-perf.log`
/// (`PerfLogFile::create(None)` is the disabled sink, perf_file.rs). A normal
/// session passes both through unchanged. Pure, so the decision is
/// unit-testable at the command level.
fn session_side_effects(
    preview: bool,
    saves: Option<GameSaves>,
    perf_log_path: Option<PathBuf>,
) -> (Option<GameSaves>, Option<PathBuf>) {
    if preview {
        (None, None)
    } else {
        (saves, perf_log_path)
    }
}

/// Probes `core_path`'s declared options (W282) and seeds each one's
/// effective value (persisted, or the core's own default) into the
/// process-global store [`native::environment`]'s `GET_VARIABLE` handler
/// reads from. Best-effort: a probe failure (e.g. a core that crashes on a
/// bare `retro_init`) or a persistence read error is logged and otherwise
/// ignored — a session must still be able to boot without its options
/// screen ever having been opened.
fn seed_persisted_core_variables(db: &Db, system: &str, core_id: &str, core_path: &Path) {
    match core_options::resolve_effective_options(db, system, core_id, core_path) {
        Ok(options) => {
            let values = options.into_iter().map(|o| (o.key, o.value)).collect();
            native::set_core_variables(values);
        }
        Err(e) => {
            eprintln!(
                "[rgp-native] core-options probe failed for {core_id} ({system}), \
                 booting with the core's own defaults: {e}"
            );
        }
    }
}

/// Starts a native session for `game_id`, replacing any session already
/// running. Resolves the installed `fceumm` core path (W213) and the game's
/// ROM path (the library row), then spawns the runtime (W212).
///
/// `preview` (v0.27 W273, default false so existing callers are unchanged):
/// start as a NO-TRACE preview — no save wiring, no perf log (see
/// [`session_side_effects`]). Library-life purity (no play-session record) is
/// the frontend's half of the contract (`NativePlayer` in the "preview"
/// presentation skips `usePlaySession`).
#[tauri::command]
pub fn start_native_play(
    game_id: i64,
    preview: Option<bool>,
    db: State<'_, Db>,
    session: State<'_, NativeSession>,
) -> AppResult<()> {
    if !AppConfig::load(&Paths::app_support()?)?.native_play_enabled {
        return Err(AppError::Unsupported(
            "native play is disabled — enable it in Settings first".into(),
        ));
    }
    let game = LibraryRepo::new(&db).get_game(game_id)?;
    if game.system != native::NATIVE_SYSTEM {
        return Err(AppError::Unsupported(format!(
            "native hosting only supports {} — game {} is {}",
            native::NATIVE_SYSTEM,
            game_id,
            game.system
        )));
    }
    let core_path = native::resolve_native_core_path(&db)?;
    let rom_path = PathBuf::from(&game.path);
    // Save persistence (W230): best-effort — an unavailable saves dir means
    // the session plays without persistence rather than failing to boot.
    let saves = Paths::app_support()
        .and_then(|p| p.saves_dir())
        .map(|root| GameSaves::new(&root, &game.system, &rom_path))
        .ok();
    // Perf telemetry file (W274): best-effort — an unresolvable logs dir
    // means the perf line stays stderr-only rather than failing the boot.
    let perf_log_path = Paths::app_support()
        .and_then(|p| p.native_perf_log_file())
        .ok();
    let (saves, perf_log_path) =
        session_side_effects(preview.unwrap_or(false), saves, perf_log_path);
    // Concurrency fix (post-W282 hotfix): hold the NativeSession mutex for
    // the whole teardown-seed-install sequence below, not just the final
    // assignment. Previously the old session stayed alive (and its core
    // thread kept calling the process-global callbacks in `play::native::
    // callbacks` — see that module's doc) until the very end of this
    // function, while `seed_persisted_core_variables`'s probe ran in between
    // and called the SAME process-global `native::install`/`native::
    // uninstall` the old session's still-running core thread was using. That
    // let a dying session's FFI calls get silently rerouted into the probe's
    // short-lived channels, and let the probe's `uninstall()` zero state a
    // live session still needed. Dropping the old runtime *before* seeding —
    // while still holding this same guard — means its `Drop` (which joins
    // both its threads to completion) has fully released the callback sinks
    // before the probe ever calls `native::install()`, and no other caller
    // (e.g. `list_core_options`) can observe a "no session" gap and start its
    // own probe in the window between teardown and the new session's install.
    //
    // Lock-ordering note: this acquires `NativeSession`'s mutex first, then
    // (transitively, inside `seed_persisted_core_variables` /
    // `NativeRuntime::start`) `core_options::probe`'s own `PROBE_LOCK`.
    // Never acquire them in the reverse order (`PROBE_LOCK` then
    // `NativeSession`) elsewhere, or this introduces a deadlock.
    let mut guard = lock(&session);
    // Drop+join the old runtime (if any) before probing.
    guard.take();
    // W282 (core-options-design.md): seed this session's declared option
    // values — persisted value if any, else the core's own declared default
    // — before the real boot below, so a core's GET_VARIABLE queries during
    // its own retro_init see exactly what the Cores screen has saved. A
    // core with no declared options (or a probe failure) seeds nothing,
    // which is exactly today's pre-W282 behavior (GET_VARIABLE unhandled).
    seed_persisted_core_variables(&db, &game.system, native::NATIVE_CORE_ID, &core_path);
    let runtime = native::NativeRuntime::start(&core_path, &rom_path, saves, perf_log_path)?;
    *guard = Some(runtime);
    Ok(())
}

/// Sets the native session's audio gain [0, 1] — the attract-mode duck
/// (W235). No-op with no session.
#[tauri::command]
pub fn set_native_volume(gain: f32, session: State<'_, NativeSession>) -> AppResult<()> {
    if let Some(runtime) = lock(&session).as_ref() {
        runtime.set_volume(gain);
    }
    Ok(())
}

/// Pauses/resumes the running native session (the in-game overlay freezes
/// the game behind it, matching the EmulatorJS path). No-op with no session.
#[tauri::command]
pub fn set_native_paused(paused: bool, session: State<'_, NativeSession>) -> AppResult<()> {
    if let Some(runtime) = lock(&session).as_ref() {
        runtime.set_paused(paused);
    }
    Ok(())
}

/// Saves the running native session's state into `slot` ("1"–"4" or "auto").
#[tauri::command]
pub fn save_native_state(slot: String, session: State<'_, NativeSession>) -> AppResult<()> {
    GameSaves::validate_slot(&slot)?;
    lock(&session)
        .as_ref()
        .ok_or_else(|| AppError::Validation("no native session is running".into()))?
        .save_state(&slot)
}

/// Restores `slot` into the running native session.
#[tauri::command]
pub fn load_native_state(slot: String, session: State<'_, NativeSession>) -> AppResult<()> {
    GameSaves::validate_slot(&slot)?;
    lock(&session)
        .as_ref()
        .ok_or_else(|| AppError::Validation("no native session is running".into()))?
        .load_state(&slot)
}

/// One recorded save slot, for the detail page / overlay (W232).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSlotDto {
    pub slot: String,
    /// "native" | "ejs" — states only load on the path that wrote them.
    pub play_path: String,
    pub created_at: u64,
}

/// Save inventory for a game, path-agnostic (works with no session running).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSavesDto {
    pub has_sram: bool,
    pub slots: Vec<SaveSlotDto>,
}

/// Lists a game's on-disk saves (SRAM presence + state slots). Backs the
/// "Continue" affordance and the overlay slot picker (W232); shared by both
/// play paths since the layout is shared (W231).
#[tauri::command]
pub fn list_game_saves(game_id: i64, db: State<'_, Db>) -> AppResult<GameSavesDto> {
    let game = LibraryRepo::new(&db).get_game(game_id)?;
    let root = Paths::app_support()?.saves_dir()?;
    let saves = GameSaves::new(&root, &game.system, Path::new(&game.path));
    let (has_sram, slots) = saves.list();
    Ok(GameSavesDto {
        has_sram,
        slots: slots
            .into_iter()
            .map(|s| SaveSlotDto {
                slot: s.slot,
                play_path: match s.play_path {
                    PlayPath::Native => "native".into(),
                    PlayPath::Ejs => "ejs".into(),
                },
                created_at: s.created_at,
            })
            .collect(),
    })
}

/// Stops the in-flight native session, if any. A no-op if nothing is running.
#[tauri::command]
pub fn stop_native_play(session: State<'_, NativeSession>) -> AppResult<()> {
    lock(&session).take();
    Ok(())
}

/// How many bytes of header precede the RGBA payload in a non-empty
/// `get_native_frame` response: `[seq: u64 LE][width: u32 LE][height: u32 LE]`.
/// Mirrored by the frontend parser (`nativeFrame.ts`).
const FRAME_HEADER_BYTES: usize = 16;

/// Encodes a frame poll answer for the raw-bytes IPC channel (W239).
/// An empty body means "nothing to paint" — no session, no frame yet, or the
/// caller already holds this sequence number. Otherwise: the 16-byte header
/// followed by the tightly-packed RGBA8888 pixels.
fn encode_frame_response(last_seq: u64, frame: Option<(u64, Rgba8Frame)>) -> Vec<u8> {
    match frame {
        Some((seq, frame)) if seq != last_seq => {
            let mut out = Vec::with_capacity(FRAME_HEADER_BYTES + frame.data.len());
            out.extend_from_slice(&seq.to_le_bytes());
            out.extend_from_slice(&frame.width.to_le_bytes());
            out.extend_from_slice(&frame.height.to_le_bytes());
            out.extend_from_slice(&frame.data);
            out
        }
        _ => Vec::new(),
    }
}

/// The most recently produced frame as a **raw binary** IPC response — no
/// JSON, no base64 (W239; the v0.21 base64-over-JSON path cost a ~327 KB
/// string round trip plus a per-byte JS decode loop *per frame*, which is
/// what made native play stutter). Polled by the frontend on an
/// animation-frame cadence (`NativePlayer.tsx`, W214); pass the last painted
/// sequence number and an unchanged frame comes back as an empty body.
#[tauri::command]
pub fn get_native_frame(last_seq: u64, session: State<'_, NativeSession>) -> tauri::ipc::Response {
    let frame = lock(&session).as_ref().and_then(native::NativeRuntime::latest_frame);
    tauri::ipc::Response::new(encode_frame_response(last_seq, frame))
}

/// Pushes the current joypad bitmask (bit `n` = `RETRO_DEVICE_ID_JOYPAD_*`
/// value `n`, computed frontend-side in `nativeInput.ts`, W216) into the
/// running core's input state via `play::native::set_joypad_state`. No
/// session check: the target is process-global by FFI necessity (see
/// `play::native::callbacks`'s module doc) and a stray call with nothing
/// running is a harmless no-op, matching that module's existing contract.
#[tauri::command]
pub fn set_native_input(bits: u16) -> AppResult<()> {
    native::set_joypad_state(bits);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// A minimal libretro core good enough to boot a real [`NativeRuntime`] —
    /// mirrors `core::core_options::probe`'s own `STUB_CORE_WITH_OPTIONS_C`/
    /// `build_stub_core` test fixture (kept local rather than shared — a
    /// tiny, self-contained duplicate is simpler than threading a shared
    /// fixture across crate modules for one field's worth of divergence).
    /// Declares no options and accepts any ROM path unconditionally.
    const STUB_CORE_C: &str = r#"
#include <stddef.h>
#include <stdbool.h>

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

void retro_init(void) {}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }
void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Session Core";
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

    fn build_stub_core(dir: &Path) -> Option<PathBuf> {
        let c_path = dir.join("stub_session_core.c");
        std::fs::write(&c_path, STUB_CORE_C).ok()?;
        let dylib_path = dir.join("stub_session_core.dylib");
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
    fn is_session_active_is_false_with_no_session_running() {
        let session = NativeSession::default();
        assert!(!is_session_active(&session));
    }

    #[test]
    fn is_session_active_is_true_once_a_real_runtime_is_installed() {
        // Drives a real (stub) NativeRuntime through the same process-global
        // FFI callback state `core::core_options::probe`'s tests and
        // `play::native::callbacks`'s own tests share — take that lock so
        // this never races them under `cargo test`'s parallel execution.
        let _guard = native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let rom_path = dir.path().join("stub.nes");
        std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

        let session = NativeSession::default();
        assert!(!is_session_active(&session));

        let runtime = native::NativeRuntime::start(&dylib, &rom_path, None, None)
            .expect("stub runtime starts");
        *lock(&session) = Some(runtime);
        assert!(is_session_active(&session));

        // Tear down explicitly (joins both threads) before the guard drops,
        // so a later test's install() never races this session's shutdown.
        lock(&session).take();
        assert!(!is_session_active(&session));
    }

    fn frame(seq: u64) -> Option<(u64, Rgba8Frame)> {
        Some((
            seq,
            Rgba8Frame {
                data: vec![1, 2, 3, 4, 5, 6, 7, 8],
                width: 2,
                height: 1,
            },
        ))
    }

    #[test]
    fn encodes_header_then_pixels_for_a_new_frame() {
        let out = encode_frame_response(0, frame(7));
        assert_eq!(out.len(), FRAME_HEADER_BYTES + 8);
        assert_eq!(u64::from_le_bytes(out[0..8].try_into().unwrap()), 7);
        assert_eq!(u32::from_le_bytes(out[8..12].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(out[12..16].try_into().unwrap()), 1);
        assert_eq!(&out[16..], &[1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn returns_an_empty_body_when_the_caller_already_has_this_sequence() {
        assert!(encode_frame_response(7, frame(7)).is_empty());
    }

    #[test]
    fn returns_an_empty_body_with_no_frame_available() {
        assert!(encode_frame_response(0, None).is_empty());
    }

    // ---- session_side_effects (v0.27 W273 preview purity) ----
    // GameSaves::new is pure path composition (no IO), so a dummy instance is
    // safe here; the runtime-side behaviour behind `saves: None` (no SRAM
    // load/flush, no exit auto-save) is structural in run_core_loop
    // (runtime.rs), and the disabled perf sink behind `None` is covered by
    // perf_file.rs's `no_configured_path_yields_a_disabled_sink`.

    fn dummy_wiring() -> (Option<GameSaves>, Option<PathBuf>) {
        (
            Some(GameSaves::new(
                Path::new("/tmp/saves"),
                "nes",
                Path::new("/tmp/rom.nes"),
            )),
            Some(PathBuf::from("/tmp/logs/native-perf.log")),
        )
    }

    #[test]
    fn a_preview_session_drops_both_saves_and_the_perf_log() {
        let (saves, perf) = dummy_wiring();
        let (saves, perf) = session_side_effects(true, saves, perf);
        assert!(saves.is_none());
        assert!(perf.is_none());
    }

    #[test]
    fn a_normal_session_keeps_its_save_and_perf_log_wiring() {
        let (saves, perf) = dummy_wiring();
        let (saves, perf) = session_side_effects(false, saves, perf);
        assert!(saves.is_some());
        assert_eq!(perf, Some(PathBuf::from("/tmp/logs/native-perf.log")));
    }

    #[test]
    fn a_normal_session_passes_an_absent_wiring_through_unchanged() {
        let (saves, perf) = session_side_effects(false, None, None);
        assert!(saves.is_none());
        assert!(perf.is_none());
    }
}
