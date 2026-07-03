//! Native play IPC (v0.21 "Bedrock") — the opt-in feature flag (W215),
//! start/stop a native libretro core session, pull decoded RGBA frames for
//! the frontend's `<canvas>` (W214), and push joypad input into the running
//! core (W216). Mirrors `commands::play`'s shape (in-page EmulatorJS) but for
//! the native hosting path; see docs/design/native-emulation-design.md §3/§4.

use crate::config::{paths::Paths, AppConfig};
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
    let runtime = native::NativeRuntime::start(&core_path, &rom_path, saves, perf_log_path)?;
    *lock(&session) = Some(runtime);
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
