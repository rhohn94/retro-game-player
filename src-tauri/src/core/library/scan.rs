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

use super::dat::DatIndex;
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
    use crate::db::repo::library::NewContentFolder;
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

    /// Thin delegation smoke test (W334): the real behavioural coverage
    /// (dedup, identify stats, rescan convergence, ...) lives on
    /// [`RomSource::scan_folder`] in `core::sources::rom` — this module is a
    /// back-compat shim, so it only needs to prove the delegation itself
    /// wires through and returns a real report, not re-litigate behaviour
    /// already covered there.
    #[test]
    fn scan_folder_path_delegates_to_rom_source() {
        let db = Db::open_in_memory().unwrap();
        let repo = crate::db::repo::library::LibraryRepo::new(&db);
        let root = temp_dir("delegates");
        let fid = repo
            .add_folder(&NewContentFolder {
                path: root.to_string_lossy().to_string(),
                enabled: true,
                added_at: 1,
            })
            .unwrap();
        fs::write(root.join("mario.nes"), nes_rom(b"abc")).unwrap();

        let report = scan_folder_path(&db, fid, &root, None).unwrap();
        assert_eq!(report.folder_id, fid);
        assert_eq!(report.scanned, 1);
        assert_eq!(report.added, 1);
        assert_eq!(repo.list_games(None).unwrap().len(), 1);

        fs::remove_dir_all(&root).ok();
    }
}
