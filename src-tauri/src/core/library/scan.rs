//! Scan orchestration (W6): walk a content folder, hash + identify each ROM,
//! and persist new games via the library repo.
//!
//! This is the only library module that touches the database. It composes the
//! pure pieces ([`walker`], [`hasher`], [`matcher`]) and writes [`NewGame`] rows.
//! Dedup is by `games.path` (UNIQUE in §3): a path already present is skipped, so
//! a rescan is idempotent. Unidentified ROMs are still persisted (with
//! `dat_matched = false`) and counted so the UI can surface them as a flagged
//! subset.

use super::matcher::Matcher;
use super::{dat::DatIndex, hasher, walker};
use crate::db::repo::library::{Game, LibraryRepo, NewGame};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::collections::HashSet;
use std::path::Path;

/// Summary of a single folder scan, mirroring the TS `ScanReport` (§2.1).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    /// The content folder that was scanned.
    pub folder_id: i64,
    /// Total ROM files the walker found.
    pub scanned: usize,
    /// ROMs matched against the DAT (`dat_matched = true`).
    pub identified: usize,
    /// ROMs with no DAT match (flagged for the UI).
    pub unidentified: usize,
    /// New game rows inserted this scan (excludes already-present paths).
    pub added: usize,
}

/// Current Unix epoch seconds, for `added_at`. Centralized so the time source is
/// named once rather than inlined at each call site.
fn now_epoch_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Scan one content folder rooted at `root` (the folder's `path`), persisting new
/// games under `folder_id`. `dat` is the optional identification index — when
/// `None`, every ROM is treated as unidentified (filename fallback).
///
/// Existing `games.path` rows are skipped (dedup), so repeated scans converge.
/// A per-file read/hash failure is logged into the `scanned` count but does not
/// abort the scan.
pub fn scan_folder_path(
    db: &Db,
    folder_id: i64,
    root: &Path,
    dat: Option<&DatIndex>,
) -> AppResult<ScanReport> {
    let repo = LibraryRepo::new(db);

    // Existing paths under this folder — the dedup set. We also dedup within the
    // walk itself (the walker already yields unique paths, but a set keeps the
    // insertion total in the face of future symlink resolution).
    let mut known: HashSet<String> = repo
        .list_games(None)?
        .into_iter()
        .map(|g: Game| g.path)
        .collect();

    let empty = DatIndex::default();
    let index = dat.unwrap_or(&empty);
    let matcher = Matcher::new(index);

    let candidates = walker::walk(root);
    let scanned = candidates.len();
    let mut identified = 0usize;
    let mut unidentified = 0usize;
    let mut added = 0usize;
    let now = now_epoch_secs();

    for cand in candidates {
        let path_str = cand.path.to_string_lossy().to_string();

        let bytes = match std::fs::read(&cand.path) {
            Ok(b) => b,
            Err(_) => continue, // unreadable file — skip, already counted as scanned
        };
        let size_bytes = bytes.len() as i64;
        let hashes = hasher::hash_rom(&bytes, &cand.mapping.system);
        let outcome = matcher.match_rom(&hashes, &cand.path);

        if outcome.dat_matched {
            identified += 1;
        } else {
            unidentified += 1;
        }

        // Dedup by path; a rescan re-counts identify stats but inserts nothing new.
        if known.contains(&path_str) {
            continue;
        }

        let new_game = NewGame {
            folder_id,
            path: path_str.clone(),
            system: cand.mapping.system.clone(),
            crc32: Some(hashes.crc32),
            md5: Some(hashes.md5),
            clean_name: outcome.clean_name,
            dat_matched: outcome.dat_matched,
            core_hint: Some(cand.mapping.core_hint.clone()),
            art_path: None,
            size_bytes,
            added_at: now,
            // Metadata is populated by future enrichment, not by the scan (W61).
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
        };

        match repo.add_game(&new_game) {
            Ok(_) => {
                known.insert(path_str);
                added += 1;
            }
            // A racing UNIQUE collision is benign for a scan — treat as deduped.
            Err(AppError::Conflict(_)) => {}
            Err(e) => return Err(e),
        }
    }

    Ok(ScanReport {
        folder_id,
        scanned,
        identified,
        unidentified,
        added,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::library::ines::{INES_HEADER_LEN, INES_MAGIC};
    use crate::db::repo::library::NewContentFolder;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("harmony-scan-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Build a NES ROM whose header-stripped body is `body`.
    fn nes_rom(body: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&INES_MAGIC);
        v.extend_from_slice(&[0u8; INES_HEADER_LEN - 4]);
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn scan_persists_dedupes_and_reports() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("persist");
        let fid = repo
            .add_folder(&NewContentFolder {
                path: root.to_string_lossy().to_string(),
                enabled: true,
                added_at: 1,
            })
            .unwrap();

        // One NES ROM whose stripped body is "abc" (crc 352441c2), plus a snes ROM.
        fs::write(root.join("mario.nes"), nes_rom(b"abc")).unwrap();
        fs::write(root.join("zelda.sfc"), b"snesbytes").unwrap();

        // DAT identifies only the NES ROM by its stripped-body CRC.
        let dat = DatIndex::from_xml(
            r#"<datafile><game name="Mario (World)"><rom crc="352441c2"/></game></datafile>"#,
        )
        .unwrap();

        let report = scan_folder_path(&db, fid, &root, Some(&dat)).unwrap();
        assert_eq!(report.scanned, 2);
        assert_eq!(report.identified, 1);
        assert_eq!(report.unidentified, 1);
        assert_eq!(report.added, 2);

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 2);
        let mario = games.iter().find(|g| g.system == "nes").unwrap();
        assert_eq!(mario.clean_name, "Mario (World)");
        assert!(mario.dat_matched);
        assert_eq!(mario.crc32.as_deref(), Some("352441c2"));

        // Rescan: nothing new added (dedup by path), stats unchanged.
        let again = scan_folder_path(&db, fid, &root, Some(&dat)).unwrap();
        assert_eq!(again.added, 0);
        assert_eq!(again.scanned, 2);
        assert_eq!(repo.list_games(None).unwrap().len(), 2);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scan_without_dat_flags_all_unidentified() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("nodat");
        let fid = repo
            .add_folder(&NewContentFolder {
                path: root.to_string_lossy().to_string(),
                enabled: true,
                added_at: 1,
            })
            .unwrap();
        fs::write(root.join("Homebrew_Game.nes"), nes_rom(b"xyz")).unwrap();

        let report = scan_folder_path(&db, fid, &root, None).unwrap();
        assert_eq!(report.unidentified, 1);
        assert_eq!(report.identified, 0);
        let g = &repo.list_games(None).unwrap()[0];
        assert!(!g.dat_matched);
        assert_eq!(g.clean_name, "Homebrew Game");

        fs::remove_dir_all(&root).ok();
    }
}
