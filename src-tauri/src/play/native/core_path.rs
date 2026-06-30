//! Resolves the installed `fceumm` NES core's `.dylib` path for native
//! hosting, reusing the **existing** v0.7 "Forge" install pipeline
//! ([`crate::core::cores::install`] / [`CoresRepo`]) rather than a new
//! download/bundling mechanism. W213 — see
//! docs/design/native-emulation-design.md, "Open questions" (resolved
//! during planning) and release-planning-v0.21.md §2 W213.

use crate::db::repo::cores::CoresRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::path::PathBuf;

/// The only system/core pair native hosting supports — NES via `fceumm`
/// (see the design doc's Scope: "NES-first via `libloading` FFI").
pub const NATIVE_SYSTEM: &str = "nes";
pub const NATIVE_CORE_ID: &str = "fceumm";

/// Resolves the installed `fceumm` core's `.dylib` path. Returns
/// [`AppError::NotFound`] (never installs silently) if the core isn't
/// installed yet — callers surface this as a prompt into the existing Cores
/// install flow rather than treating it as an unexpected failure.
pub fn resolve_native_core_path(db: &Db) -> AppResult<PathBuf> {
    let repo = CoresRepo::new(db);
    let installed_path = repo
        .list(Some(NATIVE_SYSTEM))?
        .into_iter()
        .find(|c| c.core_id == NATIVE_CORE_ID)
        .and_then(|c| c.installed_path)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "{NATIVE_CORE_ID} core for {NATIVE_SYSTEM} is not installed — \
                 install it from the Cores screen before using native playback"
            ))
        })?;
    Ok(PathBuf::from(installed_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::cores::install;
    use crate::db::repo::cores::NewCore;

    fn memory_db() -> Db {
        Db::open_in_memory().expect("open in-memory db")
    }

    #[test]
    fn resolves_the_installed_fceumm_path() {
        let db = memory_db();
        let repo = CoresRepo::new(&db);
        repo.add(&NewCore {
            system: NATIVE_SYSTEM.into(),
            core_id: NATIVE_CORE_ID.into(),
            installed_path: Some("/cores/nes/fceumm_libretro.dylib".into()),
            version: None,
            last_modified: None,
            active: true,
        })
        .expect("seed installed core");

        let path = resolve_native_core_path(&db).expect("resolves");
        assert_eq!(path, PathBuf::from("/cores/nes/fceumm_libretro.dylib"));
    }

    #[test]
    fn missing_core_row_is_not_found_not_a_silent_install() {
        let db = memory_db();
        let err = resolve_native_core_path(&db).expect_err("no fceumm row at all");
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn known_but_not_yet_installed_core_is_not_found() {
        let db = memory_db();
        let repo = CoresRepo::new(&db);
        repo.add(&NewCore {
            system: NATIVE_SYSTEM.into(),
            core_id: NATIVE_CORE_ID.into(),
            installed_path: None, // catalog-known but never installed
            version: None,
            last_modified: None,
            active: false,
        })
        .expect("seed catalog-known core");

        let err = resolve_native_core_path(&db).expect_err("installed_path is None");
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn other_systems_and_cores_are_not_matched() {
        let db = memory_db();
        let repo = CoresRepo::new(&db);
        repo.add(&NewCore {
            system: NATIVE_SYSTEM.into(),
            core_id: "mesen".into(), // a different NES core, not fceumm
            installed_path: Some("/cores/nes/mesen_libretro.dylib".into()),
            version: None,
            last_modified: None,
            active: true,
        })
        .expect("seed a different installed core");

        let err = resolve_native_core_path(&db).expect_err("fceumm specifically isn't installed");
        assert!(matches!(err, AppError::NotFound(_)));
    }

    /// Sanity check that `NATIVE_SYSTEM`/`NATIVE_CORE_ID` are still a real,
    /// curated pair in the v0.7 catalog this module reuses — guards against
    /// the constants drifting out of sync with `system_map`.
    #[test]
    fn native_pair_is_a_real_curated_core() {
        assert!(install::list_available(&memory_db(), Some(NATIVE_SYSTEM))
            .expect("catalog lookup")
            .iter()
            .any(|c| c.core_id == NATIVE_CORE_ID));
    }
}
