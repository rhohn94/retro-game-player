//! Cores IPC adapter (W5). Thin `#[tauri::command]` wrappers over the
//! [`core::cores`](crate::core::cores) domain. Each command resolves the managed
//! [`Db`] handle + the W4 [`Paths`] layout, then runs the blocking network/IO
//! work on a blocking task so the UI thread never stalls (architecture-design.md
//! §2.2). Every command returns [`AppResult`] so failures cross the IPC seam as
//! the typed `AppError` union.

use crate::config::paths::Paths;
use crate::core::cores::install;
use crate::db::repo::cores::Core;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;

/// The cores DTO crossing the IPC seam — the repo [`Core`] row plus the
/// catalog-derived `available` flag the TS `Core` interface expects
/// (architecture-design.md §2). Field names are camelCased for the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreDto {
    pub id: i64,
    pub system: String,
    pub core_id: String,
    pub installed_path: Option<String>,
    pub version: Option<String>,
    pub last_modified: Option<i64>,
    pub active: bool,
    /// True for every curated/offered core (all DTOs the domain returns are).
    pub available: bool,
}

impl From<Core> for CoreDto {
    fn from(c: Core) -> Self {
        Self {
            id: c.id,
            system: c.system,
            core_id: c.core_id,
            installed_path: c.installed_path,
            version: c.version,
            last_modified: c.last_modified,
            active: c.active,
            available: true,
        }
    }
}

/// Map repo rows to DTOs.
fn dtos(rows: Vec<Core>) -> Vec<CoreDto> {
    rows.into_iter().map(CoreDto::from).collect()
}

/// Resolve the app-support layout. Cheap + idempotent (creates dirs once).
fn paths() -> AppResult<Paths> {
    Paths::app_support()
}

/// Run blocking network/IO work on a blocking task (off the async-runtime
/// workers and the webview UI thread), flattening the join error. The closure
/// must NOT touch the `Db` — DB access stays on the async body that holds the
/// `State` borrow, so the blocking half captures only owned data.
async fn off_thread<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("core task panicked: {e}")))?
}

/// List the curated catalog (optionally for one system), folding in install
/// state. DB-only (no network), so it runs directly on the async body.
#[tauri::command]
pub async fn list_available_cores(
    db: tauri::State<'_, Db>,
    system: Option<String>,
) -> AppResult<Vec<CoreDto>> {
    install::list_available(db.inner(), system.as_deref()).map(dtos)
}

/// List only the cores installed on disk.
#[tauri::command]
pub async fn list_installed_cores(db: tauri::State<'_, Db>) -> AppResult<Vec<CoreDto>> {
    install::list_installed(db.inner()).map(dtos)
}

/// Download, verify (arm64), install, and persist a core. The network/unzip/
/// verify half runs off-thread; the persistence half runs here with the `Db`.
#[tauri::command]
pub async fn install_core(
    db: tauri::State<'_, Db>,
    system: String,
    core_id: String,
) -> AppResult<CoreDto> {
    let paths = paths()?;
    let (sys, core) = (system.clone(), core_id.clone());
    let fetched = off_thread(move || install::fetch_verified(&paths, &sys, &core)).await?;
    install::persist_installed(db.inner(), &system, &core_id, &fetched.dest, fetched.last_modified)
        .map(CoreDto::from)
}

/// Re-fetch a core if the buildbot copy is newer; re-verify and swap. The HEAD/
/// download/verify half runs off-thread; persistence runs here.
#[tauri::command]
pub async fn update_core(db: tauri::State<'_, Db>, id: i64) -> AppResult<CoreDto> {
    let paths = paths()?;
    // DB read for the current row, then off-thread network, then DB write.
    let core = install::list_installed(db.inner())?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("installed core {id}")))?;
    let fetched = off_thread(move || install::refresh_if_newer(&paths, &core)).await?;
    match fetched {
        Some(f) => install::apply_update(db.inner(), id, &f).map(CoreDto::from),
        None => install::list_installed(db.inner())?
            .into_iter()
            .find(|c| c.id == id)
            .map(CoreDto::from)
            .ok_or_else(|| AppError::NotFound(format!("installed core {id}"))),
    }
}

/// Make an installed core the active one for its system. DB-only.
#[tauri::command]
pub async fn set_active_core(
    db: tauri::State<'_, Db>,
    system: String,
    core_id: String,
) -> AppResult<CoreDto> {
    install::set_active(db.inner(), &system, &core_id).map(CoreDto::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_dto_serializes_camelcase_with_available() {
        let dto = CoreDto::from(Core {
            id: 3,
            system: "nes".into(),
            core_id: "mesen".into(),
            installed_path: Some("/x".into()),
            version: None,
            last_modified: Some(7),
            active: true,
        });
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["coreId"], "mesen");
        assert_eq!(v["installedPath"], "/x");
        assert_eq!(v["lastModified"], 7);
        assert_eq!(v["available"], true);
    }
}
