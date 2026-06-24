//! Install manager (W5). Orchestrates the full core lifecycle on top of the
//! pure building blocks ([`super::buildbot`], [`super::arch`], [`super::system_map`])
//! and the W3 [`CoresRepo`] / W4 [`Paths`]:
//!
//!   install  → download → unzip → arch-verify (reject non-arm64) → place under
//!              app-support `cores/<system>/<core>_libretro.dylib` → persist.
//!   update   → re-fetch if the buildbot `Last-Modified` is newer; re-verify; swap.
//!   activate → mark a `(system, core_id)` active (repo enforces one-per-system).
//!
//! Network/IO is blocking and must be invoked off the UI thread by the adapter.
//! Everything here is Tauri-free so it can be exercised in isolation; the only
//! non-unit-testable seam is the live buildbot fetch.

use super::{arch, buildbot, system_map};
use crate::config::paths::Paths;
use crate::db::repo::cores::{Core, CoresRepo, NewCore};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// List the curated catalog as [`Core`] DTOs, marking each pair `available` and
/// folding in any persisted install/active state for the same `(system, core)`.
pub fn list_available(db: &Db, system: Option<&str>) -> AppResult<Vec<Core>> {
    let repo = CoresRepo::new(db);
    let installed = repo.list(system)?;
    let catalog = system_map::available(system)?;
    Ok(catalog
        .into_iter()
        .map(|(sys, core_id)| {
            installed
                .iter()
                .find(|c| c.system == sys && c.core_id == core_id)
                .cloned()
                .unwrap_or_else(|| catalog_core(sys, core_id))
        })
        .collect())
}

/// Only the cores actually installed on disk (persisted rows), all `available`.
pub fn list_installed(db: &Db) -> AppResult<Vec<Core>> {
    let repo = CoresRepo::new(db);
    Ok(repo
        .list(None)?
        .into_iter()
        .filter(|c| c.installed_path.is_some())
        .collect())
}

/// Outcome of the network/IO half of an install (no database touched): the
/// dylib's on-disk destination and the buildbot `Last-Modified` (epoch-seconds).
/// The adapter runs [`fetch_verified`] off-thread, then persists on the async
/// body that holds the `Db` borrow — so the blocking work never needs `Db`.
pub struct Fetched {
    pub dest: PathBuf,
    pub last_modified: Option<i64>,
}

/// Network/IO half of install: validate the pair, download, unzip, arch-verify
/// (reject non-arm64), and place the dylib under app-support. No database access
/// — pair it with [`persist_installed`]. Safe to run on a blocking task.
pub fn fetch_verified(paths: &Paths, system: &str, core_id: &str) -> AppResult<Fetched> {
    system_map::require_known(system, core_id)?;
    let archive = buildbot::download_archive(core_id)?;
    let dest = dylib_dest(paths, system, core_id)?;
    place_verified_dylib(&archive, core_id, &dest)?;
    let last_modified = buildbot::last_modified(core_id).unwrap_or(None);
    Ok(Fetched { dest, last_modified })
}

/// Install `(system, core_id)`: fetch + verify + place the dylib, then persist
/// (insert or update) and return the resulting row. Convenience for tests/non-
/// split callers; the adapter splits the two halves around the thread boundary.
pub fn install(db: &Db, paths: &Paths, system: &str, core_id: &str) -> AppResult<Core> {
    let fetched = fetch_verified(paths, system, core_id)?;
    persist_installed(db, system, core_id, &fetched.dest, fetched.last_modified)
}

/// True iff the buildbot `remote` time is strictly newer than the stored `local`
/// (or either is unknown — refresh to be safe). The freshness policy in one place.
pub fn is_newer(remote: Option<i64>, local: Option<i64>) -> bool {
    match (remote, local) {
        (Some(r), Some(l)) => r > l,
        _ => true,
    }
}

/// Network/IO half of update for an already-fetched [`Core`] row: HEAD the
/// buildbot, and if it is newer, re-download + re-verify + replace the dylib.
/// Returns `Some(Fetched)` when a refresh happened, `None` when already current.
/// No database access — pair with [`apply_update`]. Safe on a blocking task.
pub fn refresh_if_newer(paths: &Paths, core: &Core) -> AppResult<Option<Fetched>> {
    let remote = buildbot::last_modified(&core.core_id)?;
    if !is_newer(remote, core.last_modified) {
        return Ok(None);
    }
    let archive = buildbot::download_archive(&core.core_id)?;
    let dest = dylib_dest(paths, &core.system, &core.core_id)?;
    place_verified_dylib(&archive, &core.core_id, &dest)?;
    Ok(Some(Fetched {
        dest,
        last_modified: remote,
    }))
}

/// Persist a completed update for `id`, returning the refreshed row.
pub fn apply_update(db: &Db, id: i64, fetched: &Fetched) -> AppResult<Core> {
    let repo = CoresRepo::new(db);
    let core = repo.get(id)?;
    repo.set_installed(
        id,
        Some(&path_str(&fetched.dest)?),
        core.version.as_deref(),
        fetched.last_modified,
    )?;
    repo.get(id)
}

/// Update an installed core by id (non-split convenience for tests): refresh if
/// newer, then persist. A no-op returns the existing row unchanged.
pub fn update(db: &Db, paths: &Paths, id: i64) -> AppResult<Core> {
    let repo = CoresRepo::new(db);
    let core = repo.get(id)?;
    match refresh_if_newer(paths, &core)? {
        Some(fetched) => apply_update(db, id, &fetched),
        None => Ok(core),
    }
}

/// Activate `(system, core_id)` (the core must be installed). Returns the now-
/// active row; the repo's one-active-per-system invariant handles exclusivity.
pub fn set_active(db: &Db, system: &str, core_id: &str) -> AppResult<Core> {
    let repo = CoresRepo::new(db);
    let row = repo
        .list(Some(system))?
        .into_iter()
        .find(|c| c.core_id == core_id)
        .ok_or_else(|| {
            AppError::NotFound(format!("core '{core_id}' is not installed for '{system}'"))
        })?;
    repo.set_active(row.id)?;
    repo.get(row.id)
}

/// Verify the archive's dylib is arm64 and write it to `dest`, replacing any
/// prior file atomically-ish (write temp, verify, rename).
fn place_verified_dylib(archive: &[u8], core_id: &str, dest: &Path) -> AppResult<()> {
    let dylib_name = buildbot::dylib_file_name(core_id);
    let bytes = extract_dylib(archive, &dylib_name)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("dylib.part");
    write_all(&tmp, &bytes)?;
    arch::verify_arm64_dylib(&tmp).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

/// Extract the `<core>_libretro.dylib` entry from a buildbot zip archive.
fn extract_dylib(archive: &[u8], dylib_name: &str) -> AppResult<Vec<u8>> {
    let reader = std::io::Cursor::new(archive);
    let mut zip = zip::ZipArchive::new(reader)
        .map_err(|e| AppError::Io(format!("opening core archive: {e}")))?;
    // Prefer the exact-named entry; fall back to the first `.dylib` in the zip.
    let target_index = (0..zip.len()).find(|&i| {
        zip.by_index(i)
            .map(|f| {
                let name = f.name();
                name.ends_with(dylib_name) || name.ends_with(".dylib")
            })
            .unwrap_or(false)
    });
    let idx = target_index
        .ok_or_else(|| AppError::Io(format!("no .dylib entry in archive for {dylib_name}")))?;
    let mut entry = zip
        .by_index(idx)
        .map_err(|e| AppError::Io(format!("reading archive entry: {e}")))?;
    let mut out = Vec::new();
    entry
        .read_to_end(&mut out)
        .map_err(|e| AppError::Io(format!("extracting dylib: {e}")))?;
    Ok(out)
}

/// Insert-or-update the persisted row for an installed core, returning it with
/// `available = true`.
pub fn persist_installed(
    db: &Db,
    system: &str,
    core_id: &str,
    dest: &Path,
    last_modified: Option<i64>,
) -> AppResult<Core> {
    let repo = CoresRepo::new(db);
    let path = path_str(dest)?;
    let existing = repo
        .list(Some(system))?
        .into_iter()
        .find(|c| c.core_id == core_id);
    let id = match existing {
        Some(c) => {
            repo.set_installed(c.id, Some(&path), c.version.as_deref(), last_modified)?;
            c.id
        }
        None => repo.add(&NewCore {
            system: system.to_string(),
            core_id: core_id.to_string(),
            installed_path: Some(path),
            version: None,
            last_modified,
            active: false,
        })?,
    };
    repo.get(id)
}

/// app-support `cores/<system>/<core>_libretro.dylib` destination path.
fn dylib_dest(paths: &Paths, system: &str, core_id: &str) -> AppResult<PathBuf> {
    Ok(paths
        .cores_dir()?
        .join(system)
        .join(buildbot::dylib_file_name(core_id)))
}

/// A catalog-only [`Core`] (offered but not installed): no id/path, available.
fn catalog_core(system: &str, core_id: &str) -> Core {
    Core {
        id: 0,
        system: system.to_string(),
        core_id: core_id.to_string(),
        installed_path: None,
        version: None,
        last_modified: None,
        active: false,
    }
}

/// Render a path as UTF-8, erroring on non-UTF-8 (unexpected on macOS).
fn path_str(p: &Path) -> AppResult<String> {
    p.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Io(format!("non-UTF-8 path: {}", p.display())))
}

/// Write `bytes` to `path`, creating/truncating.
fn write_all(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let mut f = std::fs::File::create(path)?;
    f.write_all(bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths() -> Paths {
        let tmp = std::env::temp_dir().join(format!(
            "harmony-install-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        Paths::with_root(tmp.join("com.harmony.app")).expect("paths")
    }

    #[test]
    fn dylib_dest_lives_under_cores_system_dir() {
        let paths = temp_paths();
        let dest = dylib_dest(&paths, "nes", "mesen").unwrap();
        assert!(dest.ends_with("cores/nes/mesen_libretro.dylib"));
    }

    #[test]
    fn list_available_marks_uninstalled_catalog_entries() {
        let db = Db::open_in_memory().unwrap();
        let cores = list_available(&db, Some("nes")).unwrap();
        assert_eq!(cores.len(), 2);
        assert!(cores.iter().all(|c| c.installed_path.is_none()));
        assert!(cores.iter().any(|c| c.core_id == "mesen"));
    }

    #[test]
    fn list_available_unknown_system_errors() {
        let db = Db::open_in_memory().unwrap();
        assert!(matches!(
            list_available(&db, Some("xyz")),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn install_rejects_uncurated_pair_before_any_network() {
        let db = Db::open_in_memory().unwrap();
        let paths = temp_paths();
        // 'nestopia' is not curated for nes → fails on the map check, no fetch.
        assert!(matches!(
            install(&db, &paths, "nes", "nestopia"),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn set_active_requires_an_installed_core() {
        let db = Db::open_in_memory().unwrap();
        assert!(matches!(
            set_active(&db, "nes", "mesen"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn extract_dylib_pulls_the_named_entry_from_a_zip() {
        // Build an in-memory zip containing a fake dylib payload.
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut zw = zip::ZipWriter::new(cursor);
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            zw.start_file("mesen_libretro.dylib", opts).unwrap();
            zw.write_all(b"FAKE-DYLIB-BYTES").unwrap();
            zw.finish().unwrap();
        }
        let out = extract_dylib(&buf, "mesen_libretro.dylib").unwrap();
        assert_eq!(out, b"FAKE-DYLIB-BYTES");
    }

    #[test]
    fn place_verified_dylib_rejects_non_arm64_payload() {
        // Zip a non-Mach-O payload; arch verification must reject and clean up.
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut zw = zip::ZipWriter::new(cursor);
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            zw.start_file("mesen_libretro.dylib", opts).unwrap();
            zw.write_all(b"not a mach-o binary").unwrap();
            zw.finish().unwrap();
        }
        let paths = temp_paths();
        let dest = dylib_dest(&paths, "nes", "mesen").unwrap();
        assert!(matches!(
            place_verified_dylib(&buf, "mesen", &dest),
            Err(AppError::Unsupported(_))
        ));
        assert!(!dest.exists()); // rejected file not left behind
    }

    #[test]
    fn place_verified_dylib_installs_arm64_payload() {
        // A minimal arm64 thin Mach-O header passes verification → file lands.
        let mut header = Vec::new();
        header.extend_from_slice(&0xFEED_FACFu32.to_le_bytes()); // MH_MAGIC_64
        header.extend_from_slice(&(12u32 | 0x0100_0000).to_le_bytes()); // arm64 cputype
        header.extend_from_slice(&[0u8; 24]);
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut zw = zip::ZipWriter::new(cursor);
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
            zw.start_file("mesen_libretro.dylib", opts).unwrap();
            zw.write_all(&header).unwrap();
            zw.finish().unwrap();
        }
        let paths = temp_paths();
        let dest = dylib_dest(&paths, "nes", "mesen").unwrap();
        place_verified_dylib(&buf, "mesen", &dest).unwrap();
        assert!(dest.exists());
        std::fs::remove_dir_all(paths.root().parent().unwrap()).ok();
    }
}
