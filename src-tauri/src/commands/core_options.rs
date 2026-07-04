//! Core-options IPC adapter (v0.29 W282, core-options-design.md). Thin
//! `#[tauri::command]` wrappers over [`core::core_options`] — mirrors the
//! shape and conventions of `commands::cores` (DTO + async command + a
//! blocking-task seam for the FFI probe, which loads a real `.dylib` and
//! must not run on the webview UI thread). Native FFI-hosted cores only
//! (currently `fceumm` NES); RetroArch-external and EmulatorJS cores have no
//! commands here by design (they never call `resolve_native_core_path`).

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
#[tauri::command]
pub async fn list_core_options(db: tauri::State<'_, Db>, system: String) -> AppResult<Vec<CoreOptionDto>> {
    require_native_system(&system)?;
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
}
