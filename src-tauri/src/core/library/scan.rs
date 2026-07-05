//! Scan orchestration (W6, migrated onto `GameSource` in W322): walk a
//! content folder, hash + identify each ROM, and persist new games via the
//! library repo.
//!
//! v0.32 W322 moved the actual scan/dedup/persist logic onto
//! [`crate::core::sources::rom::RomSource`] — the ROM folder scanner is now
//! "just another `GameSource`", alongside `SteamScanner` / `AppScanner`. This
//! module is kept as a thin, IPC-facing shim so `scan_folder_path` /
//! `ScanReport` remain stable call sites (`commands::library`, the wider
//! test suite) with zero duplicated logic — see
//! `docs/design/non-retro-library-design.md` §ROM scanner on GameSource.

use crate::core::sources::rom::RomSource;
use crate::db::Db;
use crate::error::AppResult;
use std::path::Path;

pub use super::dat::DatIndex;
pub use crate::core::sources::rom::ScanReport;

/// Scan one content folder rooted at `root` (the folder's `path`), persisting new
/// games under `folder_id`. `dat` is the optional identification index — when
/// `None`, every ROM is treated as unidentified (filename fallback).
///
/// Existing `games.path` rows are skipped (dedup), so repeated scans converge.
/// A per-file read/hash failure is logged into the `scanned` count but does not
/// abort the scan. Delegates to [`RomSource::scan_folder`] (W322) — this
/// function is kept only so existing call sites don't need to change.
pub fn scan_folder_path(
    db: &Db,
    folder_id: i64,
    root: &Path,
    dat: Option<&DatIndex>,
) -> AppResult<ScanReport> {
    RomSource::new(db).scan_folder(folder_id, root, dat)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::library::ines::{INES_HEADER_LEN, INES_MAGIC};
    use crate::db::repo::library::{Game, LibraryRepo, NewContentFolder};
    use crate::db::repo::Repository;
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
        let mario = games.iter().find(|g: &&Game| g.system.as_deref() == Some("nes")).unwrap();
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
