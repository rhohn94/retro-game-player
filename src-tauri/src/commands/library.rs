//! Library IPC adapters (W6/W13). Thin `#[tauri::command]` wrappers over the
//! library repo (W3) and the scan/identify domain (`core::library`, W6). Adapters
//! own the camelCase wire DTOs (architecture-design.md §2) and translate repo
//! rows into them; the domain stays pure and Tauri-free.

use crate::config::paths::Paths;
use crate::config::AppConfig;
use crate::core::library::{scan_folder_path, DatIndex, ScanReport};
use crate::db::repo::library::{ContentFolder, Game, LibraryRepo, NewContentFolder};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
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

// --- W51: create-a-games-folder ---------------------------------------------

/// The default games directory (`~/Games`) suggested when the user does not
/// supply a path of their own.
fn default_games_dir() -> AppResult<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Io("could not resolve the home directory".to_string()))?;
    Ok(home.join("Games"))
}

/// Whether `path` is a safe target to create a games folder at. Requires an
/// absolute path and refuses the filesystem root and top-level system dirs, so a
/// stray empty/`/`/`/System` value can never trigger a create there.
fn is_safe_games_target(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    let lower = path.to_string_lossy().to_lowercase();
    let trimmed = lower.trim_end_matches('/');
    if trimmed.is_empty() {
        return false; // the root "/" collapses to "" here
    }
    const BLOCKED: &[&str] = &[
        "/system",
        "/library",
        "/applications",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/private",
        "/users",
    ];
    !BLOCKED.contains(&trimmed)
}

/// Suggest (without creating) the default games-directory path, so the confirm
/// dialog can pre-fill it. Returns an absolute path string.
#[tauri::command]
pub async fn suggest_games_dir() -> AppResult<String> {
    Ok(default_games_dir()?.to_string_lossy().into_owned())
}

/// Tauri-free core of [`create_games_folder`] so it is unit-testable without
/// constructing a Tauri `State`. Validates the target, creates it idempotently,
/// persists it to `AppConfig.games_dir`, and returns the absolute path.
fn create_games_folder_inner(paths: &Paths, suggested_path: Option<String>) -> AppResult<String> {
    let target = match suggested_path {
        Some(s) if !s.trim().is_empty() => PathBuf::from(s.trim()),
        _ => default_games_dir()?,
    };
    if !is_safe_games_target(&target) {
        return Err(AppError::Validation(format!(
            "refusing to create a games folder at an unsafe location: {}",
            target.display()
        )));
    }
    if target.exists() && !target.is_dir() {
        return Err(AppError::Validation(format!(
            "path exists and is not a directory: {}",
            target.display()
        )));
    }
    std::fs::create_dir_all(&target)?;
    let abs = target.to_string_lossy().into_owned();

    // Persist as the configured games dir (load → set → save).
    let mut cfg = AppConfig::load(paths)?;
    cfg.games_dir = Some(abs.clone());
    cfg.save(paths)?;

    Ok(abs)
}

/// Create a games directory at the user-confirmed location and persist it to
/// `AppConfig.games_dir`. When `suggested_path` is empty/absent the default
/// `~/Games` is used. Creation is idempotent (`create_dir_all` never overwrites
/// existing data — it only ensures the directory exists) and refuses unsafe
/// targets or a path that already exists as a non-directory. Returns the
/// absolute path of the directory.
#[tauri::command]
pub async fn create_games_folder(
    paths: State<'_, Paths>,
    suggested_path: Option<String>,
) -> AppResult<String> {
    create_games_folder_inner(&paths, suggested_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_target(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("harmony-games-{tag}-{}", std::process::id()))
    }

    #[test]
    fn suggest_games_dir_is_absolute_and_ends_with_games() {
        let p = tauri::async_runtime::block_on(suggest_games_dir()).expect("suggest");
        assert!(Path::new(&p).is_absolute());
        assert!(p.ends_with("Games"));
    }

    #[test]
    fn create_games_folder_creates_and_persists() {
        let tmp = temp_target("create");
        std::fs::remove_dir_all(&tmp).ok();
        let paths = Paths::with_root(tmp.join("root")).expect("root");
        let target = tmp.join("MyGames");

        let out = create_games_folder_inner(&paths, Some(target.to_string_lossy().into_owned()))
            .expect("create");

        assert_eq!(out, target.to_string_lossy());
        assert!(target.is_dir());
        // Persisted into AppConfig.
        let cfg = AppConfig::load(&paths).expect("load cfg");
        assert_eq!(cfg.games_dir.as_deref(), Some(out.as_str()));

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn create_games_folder_is_idempotent() {
        let tmp = temp_target("idem");
        std::fs::remove_dir_all(&tmp).ok();
        let paths = Paths::with_root(tmp.join("root")).expect("root");
        let target = tmp.join("Games");
        std::fs::create_dir_all(&target).unwrap();
        // Pre-existing file inside must survive a re-create.
        let sentinel = target.join("keep.txt");
        std::fs::write(&sentinel, b"hi").unwrap();

        create_games_folder_inner(&paths, Some(target.to_string_lossy().into_owned()))
            .expect("create");

        assert!(sentinel.is_file(), "existing data must be preserved");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn create_games_folder_rejects_unsafe_target() {
        let tmp = temp_target("unsafe");
        let paths = Paths::with_root(tmp.join("root")).expect("root");
        // Note: an empty string means "use the default" (not a rejection) — see
        // create_games_folder_inner; these are explicit unsafe targets.
        for bad in ["/", "/System", "/Users", "relative/games"] {
            let res = create_games_folder_inner(&paths, Some(bad.to_string()));
            assert!(res.is_err(), "expected {bad:?} to be rejected");
        }
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn create_games_folder_rejects_existing_file() {
        let tmp = temp_target("isfile");
        std::fs::remove_dir_all(&tmp).ok();
        std::fs::create_dir_all(&tmp).unwrap();
        let paths = Paths::with_root(tmp.join("root")).expect("root");
        let file = tmp.join("not-a-dir");
        std::fs::write(&file, b"x").unwrap();

        let res = create_games_folder_inner(&paths, Some(file.to_string_lossy().into_owned()));
        assert!(res.is_err());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn is_safe_games_target_logic() {
        assert!(is_safe_games_target(Path::new("/Users/me/Games")));
        assert!(is_safe_games_target(Path::new("/Volumes/External/Games")));
        assert!(!is_safe_games_target(Path::new("/")));
        assert!(!is_safe_games_target(Path::new("/System")));
        assert!(!is_safe_games_target(Path::new("/Users")));
        assert!(!is_safe_games_target(Path::new("relative")));
    }
}
