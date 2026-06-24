//! Library IPC adapters (W6/W13). Thin `#[tauri::command]` wrappers over the
//! library repo (W3) and the scan/identify domain (`core::library`, W6). Adapters
//! own the camelCase wire DTOs (architecture-design.md §2) and translate repo
//! rows into them; the domain stays pure and Tauri-free.

use crate::core::library::{scan_folder_path, DatIndex, ScanReport};
use crate::db::repo::library::{ContentFolder, Game, LibraryRepo, NewContentFolder};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// Wire DTO for a content folder (camelCase per §2). Mirrors TS `ContentFolder`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentFolderDto {
    pub id: i64,
    pub path: String,
    pub enabled: bool,
    pub added_at: i64,
}

impl From<ContentFolder> for ContentFolderDto {
    fn from(f: ContentFolder) -> Self {
        Self {
            id: f.id,
            path: f.path,
            enabled: f.enabled,
            added_at: f.added_at,
        }
    }
}

/// Wire DTO for a game (camelCase per §2). Mirrors TS `Game`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDto {
    pub id: i64,
    pub path: String,
    pub system: String,
    pub crc32: Option<String>,
    pub md5: Option<String>,
    pub clean_name: String,
    pub dat_matched: bool,
    pub core_hint: Option<String>,
    pub art_path: Option<String>,
    pub size_bytes: i64,
    pub added_at: i64,
}

impl From<Game> for GameDto {
    fn from(g: Game) -> Self {
        Self {
            id: g.id,
            path: g.path,
            system: g.system,
            crc32: g.crc32,
            md5: g.md5,
            clean_name: g.clean_name,
            dat_matched: g.dat_matched,
            core_hint: g.core_hint,
            art_path: g.art_path,
            size_bytes: g.size_bytes,
            added_at: g.added_at,
        }
    }
}

/// Current Unix epoch seconds for `added_at` on new folders.
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Add a content folder to the library config and return the persisted row.
/// Validates the path is non-empty and exists as a directory before inserting.
#[tauri::command]
pub async fn add_content_folder(db: State<'_, Db>, path: String) -> AppResult<ContentFolderDto> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("content folder path is empty".to_string()));
    }
    if !Path::new(trimmed).is_dir() {
        return Err(AppError::Validation(format!(
            "content folder does not exist: {trimmed}"
        )));
    }
    let repo = LibraryRepo::new(&db);
    let id = repo.add_folder(&NewContentFolder {
        path: trimmed.to_string(),
        enabled: true,
        added_at: now_epoch_secs(),
    })?;
    Ok(repo.get_folder(id)?.into())
}

/// List all configured content folders.
#[tauri::command]
pub async fn list_content_folders(db: State<'_, Db>) -> AppResult<Vec<ContentFolderDto>> {
    let repo = LibraryRepo::new(&db);
    Ok(repo.list_folders()?.into_iter().map(Into::into).collect())
}

/// Remove a content folder (cascades to its games via the FK).
#[tauri::command]
pub async fn remove_content_folder(db: State<'_, Db>, id: i64) -> AppResult<()> {
    LibraryRepo::new(&db).delete_folder(id)
}

/// Scan a single content folder by id: walk, hash, identify, persist new games.
/// Returns the scan summary (`ScanReport`). v0.1 ships no bundled DAT, so ROMs
/// are identified only when a DAT index is later wired in; absent one, they are
/// surfaced as unidentified.
#[tauri::command]
pub async fn scan_folder(db: State<'_, Db>, id: i64) -> AppResult<ScanReport> {
    let repo = LibraryRepo::new(&db);
    let folder = repo.get_folder(id)?;
    let dat = load_dat();
    scan_folder_path(&db, folder.id, Path::new(&folder.path), dat.as_ref())
}

/// Rescan every enabled content folder, accumulating one combined report.
#[tauri::command]
pub async fn rescan(db: State<'_, Db>) -> AppResult<ScanReport> {
    let repo = LibraryRepo::new(&db);
    let dat = load_dat();
    let mut total = ScanReport {
        folder_id: 0,
        scanned: 0,
        identified: 0,
        unidentified: 0,
        added: 0,
    };
    for folder in repo.list_folders()? {
        if !folder.enabled {
            continue;
        }
        let r = scan_folder_path(&db, folder.id, Path::new(&folder.path), dat.as_ref())?;
        total.folder_id = folder.id;
        total.scanned += r.scanned;
        total.identified += r.identified;
        total.unidentified += r.unidentified;
        total.added += r.added;
    }
    Ok(total)
}

/// List games, optionally filtered by system.
#[tauri::command]
pub async fn list_games(db: State<'_, Db>, system: Option<String>) -> AppResult<Vec<GameDto>> {
    let repo = LibraryRepo::new(&db);
    Ok(repo
        .list_games(system.as_deref())?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Fetch a single game by id.
#[tauri::command]
pub async fn get_game(db: State<'_, Db>, id: i64) -> AppResult<GameDto> {
    Ok(LibraryRepo::new(&db).get_game(id)?.into())
}

/// Load the No-Intro DAT index, if one is bundled/configured. v0.1 ships none,
/// so this returns `None`; the seam is here for W8/W13 to supply a DAT later.
fn load_dat() -> Option<DatIndex> {
    None
}
