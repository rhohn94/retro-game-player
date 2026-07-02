//! On-demand in-page (EmulatorJS) core IPC (v0.24 W241, #17): list the
//! curated core catalog with per-system installed status, and install one
//! system's core (download + SHA-256 verify + cache;
//! [`crate::play::ejs_cores`]). Backs `PlaySwitch`'s get-core affordance —
//! see docs/design/in-page-play-design.md §7.

use crate::config::paths::Paths;
use crate::error::{AppError, AppResult};
use crate::play::ejs_cores;
use serde::Serialize;

/// One curated on-demand core, with install state (mirrors the frontend's
/// `InPageCore`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InPageCoreDto {
    /// EmulatorJS core name — also the `?core=` value the player page takes.
    pub core: String,
    /// Harmony system keys this core covers.
    pub systems: Vec<String>,
    pub installed: bool,
    pub size_bytes: u64,
}

/// The curated on-demand core catalog with installed status. The embedded
/// NES core is not listed — it is always available and needs no acquisition.
#[tauri::command]
pub fn list_inpage_cores() -> AppResult<Vec<InPageCoreDto>> {
    let root = Paths::app_support()?.ejs_cores_dir()?;
    Ok(ejs_cores::CATALOG
        .iter()
        .map(|entry| InPageCoreDto {
            core: entry.core.to_string(),
            systems: entry.systems.iter().map(|s| s.to_string()).collect(),
            installed: ejs_cores::is_installed(&root, entry),
            size_bytes: entry.size_bytes,
        })
        .collect())
}

/// Downloads + verifies + caches the core covering `system`. Idempotent.
/// Runs on Tauri's command thread pool (blocking network is fine there);
/// the ~1 MB payloads keep it short.
#[tauri::command]
pub fn install_inpage_core(system: String) -> AppResult<()> {
    let entry = ejs_cores::entry_for_system(&system).ok_or_else(|| {
        AppError::Unsupported(format!("no on-demand in-page core covers system {system}"))
    })?;
    let root = Paths::app_support()?.ejs_cores_dir()?;
    ejs_cores::install(&root, entry)
}
