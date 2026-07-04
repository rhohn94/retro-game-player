//! Core-options IPC adapter (v0.29 W282, core-options-design.md). Thin
//! `#[tauri::command]` wrappers over [`core::core_options`] — mirrors the
//! shape and conventions of `commands::cores` (DTO + async command + a
//! blocking-task seam for the FFI probe, which loads a real `.dylib` and
//! must not run on the webview UI thread). Native FFI-hosted cores only
//! (currently `fceumm` NES); RetroArch-external and EmulatorJS cores have no
//! commands here by design (they never call `resolve_native_core_path`).

use crate::commands::native_play::{is_session_active, NativeSession};
use crate::core::core_options;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::play::native;
use serde::Serialize;

/// One core-declared option crossing the IPC seam, camelCased for the
/// frontend — mirrors `core_options::EffectiveOption` (architecture-design.md §2's
/// camelCase convention, same as `CoreDto`).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoreOptionDto {
    pub key: String,
    pub description: String,
    pub choices: Vec<String>,
    pub value: String,
}

impl From<core_options::EffectiveOption> for CoreOptionDto {
    fn from(o: core_options::EffectiveOption) -> Self {
        Self {
            key: o.key,
            description: o.description,
            choices: o.choices,
            value: o.value,
        }
    }
}

/// Run blocking FFI work (loading a real core `.dylib`) on a blocking task,
/// off the async-runtime workers and the webview UI thread — same pattern as
/// `commands::cores::off_thread`.
async fn off_thread<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("core-options task panicked: {e}")))?
}

/// Lists the active native-hosted core's declared options for `system`, each
/// paired with its effective value (persisted, or the core's own declared
/// default). `system` must currently be [`native::NATIVE_SYSTEM`] — any other
/// system has no native-hosted core and returns `AppError::Unsupported`,
/// which the frontend uses to withhold the entry point entirely (acceptance:
/// "no core-options entry point for systems that don't route through the
/// native FFI host").
///
/// The FFI probe (loading the real core `.dylib`) runs off-thread, matching
/// `commands::cores`'s pattern: the blocking closure touches no `Db`, and the
/// persisted-value resolution runs back on the async body afterward, where
/// the `State<Db>` borrow is held.
///
/// Concurrency (post-W282 hotfix): the probe drives the same process-global
/// FFI callback sinks (`play::native::callbacks`) a live
/// [`native::NativeRuntime`] session uses, and `core::core_options::probe`'s
/// own lock only guards against a second concurrent probe — not a live
/// session (see that module's doc). So before ever calling the probe, this
/// command checks [`is_session_active`] and refuses outright
/// (`AppError::Conflict`) while a session — including a TV-preview session —
/// is running, rather than risk the probe's `install()`/`uninstall()` racing
/// that session's core thread. This is a deliberate empty-vs-error
/// distinction: an empty `Vec` means "this core declares no options" (a
/// legitimate, successful answer), while `Conflict` means "can't check right
/// now — a game is running," and the frontend must be able to tell the two
/// apart rather than silently showing zero options while a session is live.
#[tauri::command]
pub async fn list_core_options(
    db: tauri::State<'_, Db>,
    session: tauri::State<'_, NativeSession>,
    system: String,
) -> AppResult<Vec<CoreOptionDto>> {
    require_native_system(&system)?;
    reject_if_session_active(is_session_active(&session))?;
    let core_path = native::resolve_native_core_path(&db)?;
    let declared = off_thread(move || core_options::probe_declared_options(&core_path)).await?;
    let values = core_options::resolve_session_variables(&db, &system, native::NATIVE_CORE_ID, &declared)?;
    let options: Vec<CoreOptionDto> = declared
        .into_iter()
        .map(|var| {
            let value = values.get(&var.key).cloned().unwrap_or_default();
            CoreOptionDto {
                key: var.key,
                description: var.description,
                choices: var.choices,
                value,
            }
        })
        .collect();
    Ok(options)
}

/// Reads one option's current effective value (persisted, or the core's
/// declared default) without re-probing every option — cheap DB-only lookup,
/// runs directly on the async body. Callers that already have the full list
/// (from [`list_core_options`]) don't need this; it exists for a caller that
/// wants a single value cheaply.
#[tauri::command]
pub async fn get_core_option(
    db: tauri::State<'_, Db>,
    system: String,
    option_key: String,
) -> AppResult<Option<String>> {
    require_native_system(&system)?;
    core_options::get_persisted_value(db.inner(), &system, native::NATIVE_CORE_ID, &option_key)
}

/// Persists one option's value for the active native-hosted core. Takes
/// effect on the next boot (no hot-reload — design doc's explicit v1 scope).
#[tauri::command]
pub async fn set_core_option(
    db: tauri::State<'_, Db>,
    system: String,
    option_key: String,
    value: String,
) -> AppResult<()> {
    require_native_system(&system)?;
    core_options::set_persisted_value(db.inner(), &system, native::NATIVE_CORE_ID, &option_key, &value)
}

/// Rejects with `AppError::Conflict` when `active` (a native play session,
/// including a TV-preview session, is currently running) — the pure decision
/// half of the [`list_core_options`] session guard (post-W282 hotfix), kept
/// separate from the `tauri::State` plumbing so it's unit-testable the same
/// way [`require_native_system`] is, without needing a real `NativeSession`/
/// `NativeRuntime` in every call site that wants to check the outcome.
fn reject_if_session_active(active: bool) -> AppResult<()> {
    if active {
        Err(AppError::Conflict(
            "a native play session is currently running — stop it before checking core options"
                .into(),
        ))
    } else {
        Ok(())
    }
}

/// Rejects any system other than the one native-FFI-hosted system Harmony
/// currently supports — the single gate every command in this module shares,
/// so RetroArch-external/EmulatorJS systems never reach the probe or the
/// persisted-value lookup.
fn require_native_system(system: &str) -> AppResult<()> {
    if system == native::NATIVE_SYSTEM {
        Ok(())
    } else {
        Err(AppError::Unsupported(format!(
            "core options are only available for natively-hosted systems ({}) — {system} \
             is played via RetroArch or EmulatorJS, which manage their own option surfaces",
            native::NATIVE_SYSTEM
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- reject_if_session_active (post-W282 hotfix: probe-vs-live-session race) ----
    // The `bool` here stands in for `is_session_active(&session)`'s real
    // answer; `commands::native_play`'s own test suite
    // (`is_session_active_is_true_once_a_real_runtime_is_installed`) covers
    // that a genuinely live `NativeRuntime` makes that function report
    // `true` — this suite covers what `list_core_options` then *does* with
    // that answer.

    #[test]
    fn reject_if_session_active_passes_through_when_no_session_is_running() {
        assert!(reject_if_session_active(false).is_ok());
    }

    #[test]
    fn reject_if_session_active_returns_conflict_when_a_session_is_running() {
        let err = reject_if_session_active(true).expect_err("active session must be rejected");
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[test]
    fn require_native_system_accepts_the_native_system() {
        assert!(require_native_system(native::NATIVE_SYSTEM).is_ok());
    }

    #[test]
    fn require_native_system_rejects_other_systems() {
        let err = require_native_system("snes").expect_err("snes is not native-hosted");
        assert!(matches!(err, AppError::Unsupported(_)));
    }

    #[test]
    fn core_option_dto_serializes_camelcase() {
        let dto = CoreOptionDto::from(core_options::EffectiveOption {
            key: "fceumm_region".into(),
            description: "Region".into(),
            choices: vec!["auto".into(), "ntsc".into(), "pal".into()],
            value: "ntsc".into(),
        });
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["key"], "fceumm_region");
        assert_eq!(v["description"], "Region");
        assert_eq!(v["choices"], serde_json::json!(["auto", "ntsc", "pal"]));
        assert_eq!(v["value"], "ntsc");
    }

    // ---- W284 (issue #28): contract coverage over the core-options IPC
    // surface against a temp SQLite db + a real (stub) core .dylib ----
    //
    // `list_core_options`/`get_core_option`/`set_core_option` all take
    // `tauri::State<'_, Db>`, which — like every other command module in
    // this crate (see e.g. `commands::cores`'s own test module) — cannot be
    // constructed outside a running `tauri::App`. Consistent with that
    // established convention, these tests drive the exact same call
    // sequence the command bodies perform (probe → resolve_session_variables
    // / get_persisted_value / set_persisted_value) directly against a real
    // `Db::open_in_memory()` and a real headlessly-compiled stub core, rather
    // than the thin `#[tauri::command]` wrapper — proving the composed
    // IPC-adjacent contract end-to-end without a full Tauri test harness.
    mod ipc_contract {
        use super::*;
        use crate::core::core_options::resolve_session_variables;
        use crate::play::native;
        use std::path::Path;
        use std::process::Command;

        /// Mirrors `core::core_options::probe`'s own stub-with-declared-
        /// options fixture (kept local — a small self-contained duplicate,
        /// same posture that module's own doc comment takes).
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
    { 0, 0 },
};

void retro_init(void) {
    env_cb(16 /* RETRO_ENVIRONMENT_SET_VARIABLES */, OPTIONS);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }
void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Contract Core";
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

        fn build_stub_core(dir: &Path) -> Option<std::path::PathBuf> {
            let c_path = dir.join("stub_contract_core.c");
            std::fs::write(&c_path, STUB_CORE_WITH_OPTIONS_C).ok()?;
            let dylib_path = dir.join("stub_contract_core.dylib");
            let status = Command::new("cc")
                .arg("-dynamiclib")
                .arg("-o")
                .arg(&dylib_path)
                .arg(&c_path)
                .status()
                .ok()?;
            status.success().then_some(dylib_path)
        }

        fn memory_db() -> Db {
            Db::open_in_memory().unwrap()
        }

        /// `set_core_option` → `get_core_option`'s real call sequence: the
        /// exact `core_options::set_persisted_value`/`get_persisted_value`
        /// pair the two async commands call, against a real db connection.
        #[test]
        fn set_then_get_core_option_round_trips_through_a_real_db() {
            let db = memory_db();
            core_options::set_persisted_value(&db, native::NATIVE_SYSTEM, native::NATIVE_CORE_ID, "fceumm_region", "pal")
                .expect("set");
            let got =
                core_options::get_persisted_value(&db, native::NATIVE_SYSTEM, native::NATIVE_CORE_ID, "fceumm_region")
                    .expect("get");
            assert_eq!(got, Some("pal".to_string()));
        }

        /// `get_core_option` on a key nothing ever persisted returns `None`
        /// (the command's real contract — the frontend falls back to the
        /// core's declared default), never an error.
        #[test]
        fn get_core_option_on_an_unset_key_is_none_not_an_error() {
            let db = memory_db();
            let got = core_options::get_persisted_value(&db, native::NATIVE_SYSTEM, native::NATIVE_CORE_ID, "never_set")
                .expect("get must not error");
            assert!(got.is_none());
        }

        /// `list_core_options`'s real body: probe a real core .dylib for its
        /// declared options, then resolve each one's effective value via
        /// `resolve_session_variables` against a real db — end to end,
        /// exactly as the command composes them (minus the `off_thread`
        /// blocking-task wrapper and the `State` extraction, which are
        /// Tauri-runtime plumbing around this same logic).
        #[test]
        fn list_core_options_probes_a_real_core_and_resolves_persisted_values() {
            let _guard = native::lock_tests();
            let dir = tempfile::tempdir().expect("tempdir");
            let Some(dylib) = build_stub_core(dir.path()) else {
                eprintln!("skipping: no C toolchain on PATH");
                return;
            };
            let db = memory_db();

            // Nothing persisted yet: falls back to the core's declared default.
            let declared = core_options::probe_declared_options(&dylib).expect("probe");
            assert_eq!(declared.len(), 1);
            let values =
                resolve_session_variables(&db, native::NATIVE_SYSTEM, native::NATIVE_CORE_ID, &declared).expect("resolve");
            assert_eq!(values.get("stub_region"), Some(&"ntsc".to_string()));

            // Persist a value (as `set_core_option` would), then re-probe +
            // re-resolve (as `list_core_options` would on the next call) —
            // the persisted value must now win over the core's default.
            core_options::set_persisted_value(&db, native::NATIVE_SYSTEM, native::NATIVE_CORE_ID, "stub_region", "pal")
                .expect("set");
            let declared_again = core_options::probe_declared_options(&dylib).expect("re-probe");
            let values_again =
                resolve_session_variables(&db, native::NATIVE_SYSTEM, native::NATIVE_CORE_ID, &declared_again)
                    .expect("resolve again");
            assert_eq!(values_again.get("stub_region"), Some(&"pal".to_string()));
        }

        /// The full `CoreOptionDto` shape `list_core_options` actually
        /// serializes to the frontend, built from a real probe + a real
        /// persisted value — proving the DTO mapping the command performs
        /// (not just `EffectiveOption`) round-trips correctly end to end.
        #[test]
        fn list_core_options_dto_mapping_reflects_the_probed_and_persisted_state() {
            let _guard = native::lock_tests();
            let dir = tempfile::tempdir().expect("tempdir");
            let Some(dylib) = build_stub_core(dir.path()) else {
                eprintln!("skipping: no C toolchain on PATH");
                return;
            };
            let db = memory_db();
            core_options::set_persisted_value(&db, native::NATIVE_SYSTEM, native::NATIVE_CORE_ID, "stub_region", "pal")
                .expect("set");

            let declared = core_options::probe_declared_options(&dylib).expect("probe");
            let values =
                resolve_session_variables(&db, native::NATIVE_SYSTEM, native::NATIVE_CORE_ID, &declared).expect("resolve");
            let options: Vec<CoreOptionDto> = declared
                .into_iter()
                .map(|var| {
                    let value = values.get(&var.key).cloned().unwrap_or_default();
                    CoreOptionDto {
                        key: var.key,
                        description: var.description,
                        choices: var.choices,
                        value,
                    }
                })
                .collect();

            assert_eq!(options.len(), 1);
            assert_eq!(options[0].key, "stub_region");
            assert_eq!(options[0].description, "Region");
            assert_eq!(options[0].choices, vec!["ntsc", "pal"]);
            assert_eq!(options[0].value, "pal");
        }
    }
}
