//! Single-file import pipeline (v0.12).
//!
//! Where [`scan`](super::scan) walks a *folder* the user already populated, this
//! brings ONE user-chosen file (drag-and-drop or the native file picker) into the
//! library's managed Games directory and registers it:
//!
//!   1. identify the system from the file extension ([`mapper`](super::mapper));
//!      an unrecognized extension is rejected so we never import junk;
//!   2. hash the bytes (CRC32 + MD5) and resolve a clean name via the
//!      [`Matcher`](super::matcher) (DAT name when available, else the filename);
//!   3. copy the file into `<games_dir>/<system>/` (a never-clobber unique name),
//!      unless it already lives inside the Games dir, in which case it is
//!      registered in place;
//!   4. ensure the Games dir is a registered content folder and insert the game.
//!
//! Pure and Tauri-free (takes a [`Db`] + the resolved games dir), so it is unit
//! tested directly; the thin command adapter resolves the games dir and triggers
//! best-effort metadata enrichment afterwards.

use super::dat::DatIndex;
use super::hasher::{hash_rom, RomHashes};
use super::mapper::{map_extension, SystemMapping};
use super::matcher::{MatchOutcome, Matcher};
use crate::db::repo::library::{LibraryRepo, NewContentFolder, NewGame};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The result of importing one file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportOutcome {
    /// The id of the game row (new, or the pre-existing one when already present).
    pub game_id: i64,
    /// Canonical system key the file was identified as.
    pub system: String,
    /// Final on-disk path inside the Games directory.
    pub stored_path: String,
    /// True when this exact path was already in the library (a no-op import).
    pub already_present: bool,
}

/// Current Unix epoch seconds for `added_at`.
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Import a single ROM file into `games_dir`, registering it under the library.
///
/// `dat` is the optional No-Intro index for clean-name matching (mirrors the
/// scanner; `None` falls back to the filename). Returns [`AppError::Unsupported`]
/// for an unrecognized extension and [`AppError::Validation`] when `src` is not a
/// readable file.
pub fn import_file(
    db: &Db,
    games_dir: &Path,
    src: &Path,
    dat: Option<&DatIndex>,
) -> AppResult<ImportOutcome> {
    if !src.is_file() {
        return Err(AppError::Validation(format!(
            "not a file: {}",
            src.display()
        )));
    }

    // 1. Identify the system from the extension (reject unknown types).
    let mapping = resolve_system(src)?;
    let system = mapping.system;

    // 2. Hash + resolve a clean name.
    let (bytes, hashes, outcome) = hash_and_match(src, &system, dat)?;
    let size_bytes = bytes.len() as i64;

    let repo = LibraryRepo::new(db);

    // 3. Content dedup FIRST (before any copy): re-importing the same ROM — even
    //    from a different folder or under a different filename — resolves to the
    //    existing library row and copies nothing. Keyed by (crc32, system).
    if let Some(existing) = dedup_by_hash(&repo, &hashes.crc32, &system)? {
        return Ok(existing);
    }

    // 4. Place the file inside the Games directory (register in place if it is
    //    already there; otherwise copy to a never-clobber unique path), ensure
    //    it is a registered content folder, and dedup again by the resulting
    //    stored path (a racing import landing at the same destination).
    let (stored_str, folder_id) = match place_and_dedup_by_path(&repo, games_dir, &system, src)? {
        Placement::AlreadyPresent(existing) => return Ok(existing),
        Placement::New { stored_path, folder_id } => (stored_path, folder_id),
    };

    // 5. Insert the game row. The `games.path` UNIQUE constraint is the
    //    backstop: a racing insert at the same path is caught as a benign
    //    Conflict and resolved to the pre-existing row.
    let new_game = NewGame {
        folder_id: Some(folder_id),
        path: Some(stored_str.clone()),
        system: Some(system.clone()),
        crc32: Some(hashes.crc32),
        md5: Some(hashes.md5),
        clean_name: outcome.clean_name,
        dat_matched: outcome.dat_matched,
        core_hint: Some(mapping.core_hint),
        art_path: None,
        size_bytes,
        added_at: now_epoch_secs(),
        year: None,
        developer: None,
        publisher: None,
        aliases: None,
        source: crate::db::repo::library::GameSource::Rom,
        launch_descriptor: None,
        external_id: None,
    };
    insert_or_resolve_conflict(&repo, new_game, &system, stored_str)
}

/// Step 1: identify the system from `src`'s extension, rejecting a missing or
/// unrecognized extension so an import never registers junk.
fn resolve_system(src: &Path) -> AppResult<SystemMapping> {
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .ok_or_else(|| AppError::Unsupported(format!("file has no extension: {}", src.display())))?;
    map_extension(ext)
        .ok_or_else(|| AppError::Unsupported(format!("unrecognized ROM extension: .{ext}")))
}

/// Step 2: read `src`'s bytes, hash them for `system`, and resolve a clean
/// name / dat-matched flag via `dat` (falls back to the filename with no
/// DAT). Returns the raw bytes too — the caller still needs `bytes.len()`
/// for `size_bytes`.
fn hash_and_match(
    src: &Path,
    system: &str,
    dat: Option<&DatIndex>,
) -> AppResult<(Vec<u8>, RomHashes, MatchOutcome)> {
    let bytes = std::fs::read(src)
        .map_err(|e| AppError::Io(format!("failed to read {}: {e}", src.display())))?;
    let hashes = hash_rom(&bytes, system);
    let empty = DatIndex::default();
    let matcher = Matcher::new(dat.unwrap_or(&empty));
    let outcome = matcher.match_rom(&hashes, src);
    Ok((bytes, hashes, outcome))
}

/// Step 3: content dedup by hash — re-importing the same ROM (even from a
/// different folder or under a different filename) resolves to the existing
/// library row rather than copying anything. Keyed by (crc32, system).
fn dedup_by_hash(
    repo: &LibraryRepo<'_>,
    crc32: &str,
    system: &str,
) -> AppResult<Option<ImportOutcome>> {
    let Some(existing) = repo.find_game_by_hash(crc32, system)? else {
        return Ok(None);
    };
    Ok(Some(ImportOutcome {
        game_id: existing.id,
        system: system.to_string(),
        // A crc32/system hash match is only ever a `rom` row (v0.31 W310),
        // which always has `path` set.
        stored_path: existing.path.unwrap_or_default(),
        already_present: true,
    }))
}

/// The result of step 4: either a racing import already landed a row at this
/// destination (resolve to it), or a fresh stored path + owning folder id to
/// insert a new row at.
enum Placement {
    AlreadyPresent(ImportOutcome),
    New { stored_path: String, folder_id: i64 },
}

/// Step 4: place `src` inside the Games directory (register in place if
/// already there, else copy to a never-clobber unique path), ensure the
/// Games dir is a registered content folder, and dedup by the resulting
/// stored path.
fn place_and_dedup_by_path(
    repo: &LibraryRepo<'_>,
    games_dir: &Path,
    system: &str,
    src: &Path,
) -> AppResult<Placement> {
    let stored = place_file(games_dir, system, src)?;
    let stored_str = stored
        .to_str()
        .ok_or_else(|| AppError::Internal("stored path is not valid UTF-8".to_string()))?
        .to_string();

    let folder_id = ensure_games_folder(repo, games_dir)?;

    if let Some(existing) = repo.get_game_by_path(&stored_str)? {
        return Ok(Placement::AlreadyPresent(ImportOutcome {
            game_id: existing.id,
            system: system.to_string(),
            stored_path: stored_str,
            already_present: true,
        }));
    }

    Ok(Placement::New {
        stored_path: stored_str,
        folder_id,
    })
}

/// Step 5: insert `new_game`, resolving a racing UNIQUE(path) insert to the
/// pre-existing row instead of failing (the same benign-conflict pattern as
/// steps 3/4).
fn insert_or_resolve_conflict(
    repo: &LibraryRepo<'_>,
    new_game: NewGame,
    system: &str,
    stored_str: String,
) -> AppResult<ImportOutcome> {
    match repo.add_game(&new_game) {
        Ok(game_id) => Ok(ImportOutcome {
            game_id,
            system: system.to_string(),
            stored_path: stored_str,
            already_present: false,
        }),
        // A racing insert won the UNIQUE(path) — resolve to the existing row.
        Err(AppError::Conflict(_)) => {
            let existing = repo.get_game_by_path(&stored_str)?.ok_or_else(|| {
                AppError::Internal("path conflict but row not found".to_string())
            })?;
            Ok(ImportOutcome {
                game_id: existing.id,
                system: system.to_string(),
                stored_path: stored_str,
                already_present: true,
            })
        }
        Err(e) => Err(e),
    }
}

/// Resolve the destination for `src` under `<games_dir>/<system>/`. If `src` is
/// already inside `games_dir`, it is registered in place (no copy). Otherwise the
/// file is copied to a unique, never-clobbering path.
fn place_file(games_dir: &Path, system: &str, src: &Path) -> AppResult<PathBuf> {
    // Already inside the managed Games dir → register in place.
    if is_within(src, games_dir) {
        return Ok(src.to_path_buf());
    }

    let dir = games_dir.join(system);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Io(format!("failed to create {}: {e}", dir.display())))?;

    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Validation("source has no file name".to_string()))?;
    let dest = unique_dest(&dir, file_name);

    std::fs::copy(src, &dest)
        .map_err(|e| AppError::Io(format!("failed to copy into Games dir: {e}")))?;
    Ok(dest)
}

/// True when `path` is located somewhere under `root`. Uses canonicalized paths
/// when both resolve, else a lexical prefix check.
fn is_within(path: &Path, root: &Path) -> bool {
    match (path.canonicalize(), root.canonicalize()) {
        (Ok(p), Ok(r)) => p.starts_with(r),
        _ => path.starts_with(root),
    }
}

/// Pick a non-existent path in `dir` for `file_name`, appending ` (1)`, ` (2)`, …
/// before the extension on collision so an import never overwrites another ROM.
fn unique_dest(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(file_name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let ext = path.extension().and_then(|e| e.to_str());
    for n in 1.. {
        let name = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("the loop returns the first free name")
}

/// Find or create the content-folder row for the Games directory, returning its
/// id. Idempotent and race-safe: an existing folder with the same path is reused
/// (via the UNIQUE(path) index), and a racing insert is caught as a benign
/// Conflict and re-resolved to the now-present row.
fn ensure_games_folder(repo: &LibraryRepo, games_dir: &Path) -> AppResult<i64> {
    let dir_str = games_dir.to_string_lossy().to_string();
    if let Some(existing) = repo.get_folder_by_path(&dir_str)? {
        return Ok(existing.id);
    }
    match repo.add_folder(&NewContentFolder {
        path: dir_str.clone(),
        enabled: true,
        added_at: now_epoch_secs(),
    }) {
        Ok(id) => Ok(id),
        Err(AppError::Conflict(_)) => repo
            .get_folder_by_path(&dir_str)?
            .map(|f| f.id)
            .ok_or_else(|| AppError::Internal("folder conflict but row not found".to_string())),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("harmony-import-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn imports_copies_into_system_subdir_and_registers() {
        let base = temp_dir("copy");
        let games = base.join("Games");
        fs::create_dir_all(&games).unwrap();
        let src = base.join("Zelda.sfc");
        fs::write(&src, b"snesbytes").unwrap();

        let db = Db::open_in_memory().unwrap();
        let out = import_file(&db, &games, &src, None).unwrap();

        assert_eq!(out.system, "snes");
        assert!(!out.already_present);
        // Copied under <games>/snes/Zelda.sfc and the original survives.
        assert!(games.join("snes").join("Zelda.sfc").is_file());
        assert!(src.is_file());
        assert_eq!(out.stored_path, games.join("snes").join("Zelda.sfc").to_string_lossy());

        // Registered in the library with the right core hint.
        let repo = LibraryRepo::new(&db);
        let g = repo.get_game(out.game_id).unwrap();
        assert_eq!(g.system.as_deref(), Some("snes"));
        assert_eq!(g.core_hint.as_deref(), Some("snes9x"));
        assert_eq!(g.clean_name, "Zelda");
        // The Games dir was registered as a content folder.
        assert_eq!(repo.list_folders().unwrap().len(), 1);

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn re_importing_same_file_is_idempotent() {
        let base = temp_dir("idem");
        let games = base.join("Games");
        fs::create_dir_all(&games).unwrap();
        let src = base.join("game.nes");
        // Minimal NES bytes (iNES handling tolerates short input).
        fs::write(&src, b"NES\x1arest").unwrap();

        let db = Db::open_in_memory().unwrap();
        let first = import_file(&db, &games, &src, None).unwrap();
        let second = import_file(&db, &games, &src, None).unwrap();

        assert!(!first.already_present);
        assert!(second.already_present);
        assert_eq!(first.game_id, second.game_id);
        // Only one game row, one folder.
        assert_eq!(LibraryRepo::new(&db).list_games(None).unwrap().len(), 1);
        // The collision-avoidance did NOT create a duplicate copy, because the
        // second import detected the already-present path.
        assert!(games.join("nes").join("game.nes").is_file());
        assert!(!games.join("nes").join("game (1).nes").exists());

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn unrecognized_extension_is_unsupported() {
        let base = temp_dir("badext");
        let games = base.join("Games");
        fs::create_dir_all(&games).unwrap();
        let src = base.join("notes.txt");
        fs::write(&src, b"hello").unwrap();

        let db = Db::open_in_memory().unwrap();
        assert!(matches!(
            import_file(&db, &games, &src, None),
            Err(AppError::Unsupported(_))
        ));
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn file_already_in_games_dir_is_registered_in_place() {
        let base = temp_dir("inplace");
        let games = base.join("Games");
        let nes_dir = games.join("nes");
        fs::create_dir_all(&nes_dir).unwrap();
        let src = nes_dir.join("Already.nes");
        fs::write(&src, b"NES\x1abody").unwrap();

        let db = Db::open_in_memory().unwrap();
        let out = import_file(&db, &games, &src, None).unwrap();
        assert!(!out.already_present);
        assert_eq!(out.stored_path, src.to_string_lossy());
        // No second copy was made.
        assert!(!games.join("nes").join("Already (1).nes").exists());

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn distinct_file_same_name_does_not_clobber() {
        let base = temp_dir("noclobber");
        let games = base.join("Games");
        fs::create_dir_all(&games).unwrap();

        // First import creates <games>/nes/rom.nes.
        let a = base.join("a").join("rom.nes");
        fs::create_dir_all(a.parent().unwrap()).unwrap();
        fs::write(&a, b"NES\x1aAAAA").unwrap();
        // A different file with the SAME name from another folder.
        let b = base.join("b").join("rom.nes");
        fs::create_dir_all(b.parent().unwrap()).unwrap();
        fs::write(&b, b"NES\x1aBBBB").unwrap();

        let db = Db::open_in_memory().unwrap();
        let first = import_file(&db, &games, &a, None).unwrap();
        let second = import_file(&db, &games, &b, None).unwrap();

        assert!(!first.already_present);
        assert!(!second.already_present);
        assert_ne!(first.stored_path, second.stored_path);
        assert!(games.join("nes").join("rom.nes").is_file());
        assert!(games.join("nes").join("rom (1).nes").is_file());
        assert_eq!(LibraryRepo::new(&db).list_games(None).unwrap().len(), 2);

        fs::remove_dir_all(&base).ok();
    }
}
