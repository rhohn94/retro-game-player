//! Direct-download IPC (v0.24 W244, #30): start/cancel a user-initiated
//! download from a `direct_download`-enabled provider, and resolve staged
//! unrecognized files. The transfer runs on its own thread and reports via
//! Tauri events, so the UI renders inline progress without polling:
//!
//!   * `download://progress` — `{ id, received, total? }`
//!   * `download://done`     — `{ id, gameId?, alreadyPresent?, stagedPath?, error? }`
//!
//! Concurrency: 3 downloads globally, 1 per provider. See
//! docs/design/direct-download-design.md.

use crate::commands::library::resolve_or_init_games_dir;
use crate::config::paths::Paths;
use crate::core::search::download::{
    self, download_and_auto_import, DownloadHooks, DownloadLanding,
};
use crate::db::repo::search_providers::SearchProvidersRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Max simultaneous downloads across all providers.
const MAX_GLOBAL: usize = 3;

/// The managed download registry: live transfers + their cancel flags, and
/// the paths worker threads need (they open their own db connection — the
/// managed `Db` can't cross threads).
pub struct Downloads {
    db_path: PathBuf,
    downloads_dir: PathBuf,
    next_id: AtomicU64,
    active: Mutex<HashMap<u64, ActiveDownload>>,
}

struct ActiveDownload {
    provider_id: i64,
    cancel: Arc<AtomicBool>,
}

impl Downloads {
    pub fn new(db_path: PathBuf, downloads_dir: PathBuf) -> Self {
        Downloads {
            db_path,
            downloads_dir,
            next_id: AtomicU64::new(1),
            active: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u64, ActiveDownload>> {
        self.active.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Reserves a slot under the global + per-provider limits.
    fn reserve(&self, provider_id: i64) -> AppResult<(u64, Arc<AtomicBool>)> {
        let mut active = self.lock();
        if active.len() >= MAX_GLOBAL {
            return Err(AppError::Validation(format!(
                "{MAX_GLOBAL} downloads are already running — wait for one to finish"
            )));
        }
        if active.values().any(|a| a.provider_id == provider_id) {
            return Err(AppError::Validation(
                "a download from this provider is already running".into(),
            ));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let cancel = Arc::new(AtomicBool::new(false));
        active.insert(id, ActiveDownload { provider_id, cancel: Arc::clone(&cancel) });
        Ok((id, cancel))
    }

    fn release(&self, id: u64) {
        self.lock().remove(&id);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    id: u64,
    received: u64,
    total: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoneEvent {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    game_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    already_present: Option<bool>,
    /// Library path of the imported file (for Reveal-in-Finder verification).
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    staged_path: Option<String>,
    /// Why import failed for an unrecognized/staged file (shown in the UI).
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Starts a download of `url` from provider `provider_id`, returning the
/// download id whose progress/done events the UI should follow. Rejects a
/// provider without the `direct_download` opt-in **server-side** — the UI
/// gate is not the contract.
#[tauri::command]
pub fn start_download(
    provider_id: i64,
    url: String,
    db: State<'_, Db>,
    downloads: State<'_, Downloads>,
    app: AppHandle,
) -> AppResult<u64> {
    let provider = SearchProvidersRepo::new(&db).get(provider_id)?;
    if !provider.direct_download {
        return Err(AppError::Validation(format!(
            "provider {} has direct download disabled — enable it in the provider settings first",
            provider.name
        )));
    }
    download::validate_scheme(&url)?;
    // Resolve the destination before spawning so config problems (no games
    // dir creatable) surface as a command error, not a mid-flight event.
    let games_dir = resolve_or_init_games_dir(&Paths::app_support()?)?;

    let (id, cancel) = downloads.reserve(provider_id)?;
    let job = DownloadJob {
        db_path: downloads.db_path.clone(),
        staging: downloads.downloads_dir.clone(),
        games_dir,
        url,
        id,
        cancel,
        app,
    };
    spawn_worker(job);
    Ok(id)
}

/// Everything the worker thread owns for one transfer.
struct DownloadJob {
    db_path: PathBuf,
    staging: PathBuf,
    games_dir: PathBuf,
    url: String,
    id: u64,
    cancel: Arc<AtomicBool>,
    app: AppHandle,
}

fn spawn_worker(job: DownloadJob) {
    std::thread::Builder::new()
        .name(format!("harmony-download-{}", job.id))
        .spawn(move || {
            let done = run_download(&job);
            // Release the concurrency slot before announcing completion.
            if let Some(downloads) = job.app.try_state::<Downloads>() {
                downloads.release(job.id);
            }
            let _ = job.app.emit("download://done", done);
        })
        .ok();
}

fn run_download(job: &DownloadJob) -> DoneEvent {
    let fail = |error: String| DoneEvent {
        id: job.id,
        game_id: None,
        already_present: None,
        file_path: None,
        staged_path: None,
        reason: None,
        error: Some(error),
    };
    let app = job.app.clone();
    let id = job.id;
    let cancel = Arc::clone(&job.cancel);
    let hooks = DownloadHooks {
        on_progress: &move |received, total| {
            let _ = app.emit("download://progress", ProgressEvent { id, received, total });
        },
        should_continue: &move || !cancel.load(Ordering::Relaxed),
    };
    let db = match Db::open(&job.db_path) {
        Ok(db) => db,
        Err(e) => return fail(format!("library unavailable: {e}")),
    };
    match download_and_auto_import(
        &job.url,
        &job.staging,
        job.id,
        &hooks,
        &db,
        &job.games_dir,
    ) {
        Ok(DownloadLanding::Imported {
            game_id,
            already_present,
            file_path,
        }) => DoneEvent {
            id: job.id,
            game_id: Some(game_id),
            already_present: Some(already_present),
            file_path: Some(file_path),
            staged_path: None,
            reason: None,
            error: None,
        },
        Ok(DownloadLanding::Unrecognized {
            staged_path,
            reason,
        }) => DoneEvent {
            id: job.id,
            game_id: None,
            already_present: None,
            file_path: None,
            staged_path: Some(staged_path.to_string_lossy().into_owned()),
            reason: Some(reason),
            error: None,
        },
        Err(e) => fail(e.to_string()),
    }
}

/// Cancels a running download; a no-op for unknown/finished ids.
#[tauri::command]
pub fn cancel_download(id: u64, downloads: State<'_, Downloads>) -> AppResult<()> {
    if let Some(active) = downloads.lock().get(&id) {
        active.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Deletes a staged unrecognized download. Only paths inside the staging dir
/// are deletable — anything else is rejected before touching the filesystem.
#[tauri::command]
pub fn discard_staged_download(path: String, downloads: State<'_, Downloads>) -> AppResult<()> {
    let target = PathBuf::from(&path);
    let staging = downloads
        .downloads_dir
        .canonicalize()
        .map_err(|e| AppError::Io(format!("staging dir: {e}")))?;
    let canonical = target
        .canonicalize()
        .map_err(|e| AppError::Validation(format!("no such staged file: {e}")))?;
    if !canonical.starts_with(&staging) || !canonical.is_file() {
        return Err(AppError::Validation(
            "only staged downloads can be discarded".into(),
        ));
    }
    std::fs::remove_file(&canonical)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> Downloads {
        Downloads::new(PathBuf::from("/tmp/x.db"), PathBuf::from("/tmp/dl"))
    }

    #[test]
    fn concurrency_caps_global_and_per_provider() {
        let d = registry();
        let (a, _) = d.reserve(1).unwrap();
        assert!(d.reserve(1).is_err(), "second download for one provider");
        let (_b, _) = d.reserve(2).unwrap();
        let (_c, _) = d.reserve(3).unwrap();
        assert!(d.reserve(4).is_err(), "fourth global download");
        d.release(a);
        assert!(d.reserve(4).is_ok(), "slot frees on release");
    }
}
