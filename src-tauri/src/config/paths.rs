//! Canonical filesystem path resolver for Harmony (macOS / Apple Silicon).
//!
//! This is the SINGLE source of truth for every on-disk location, per master
//! contract architecture-design.md §4. Nothing else hard-codes a path; all
//! consumers (W3 db, W8 art, W10 blur, W11 fleet, telemetry) go through
//! `Paths`. The two layouts:
//!
//!   §4.1 app-support — `~/Library/Application Support/com.harmony.app/`
//!         (`harmony.db`, `config/`, `cores/`, `art-cache/`, `blur-cache/`,
//!         `logs/`).
//!   §4.2 deployed-instance — `deployed-apps/harmony/versions/{vX.Y.Z}/` with a
//!         `current` symlink the fleet reads.
//!
//! All accessors that name a directory create it (idempotently) so callers can
//! assume the parent exists. File accessors create only their parent dir.

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// macOS bundle identifier; the app-support root folder name (§4.1).
pub const BUNDLE_ID: &str = "com.harmony.app";

/// SQLite database filename under the app-support root (§3, §4.1).
pub const DB_FILE_NAME: &str = "harmony.db";

/// App-config filename under `config/` (§4.1).
pub const APP_CONFIG_FILE_NAME: &str = "app-config.json";

/// `run.json` telemetry filename in the deployed version dir (§4.2).
pub const RUN_FILE_NAME: &str = "run.json";

/// Deployed-apps subtree under the deployed root (§4.2).
const DEPLOYED_APP_DIR: &str = "harmony";

/// Canonical path resolver. Construct with [`Paths::app_support`] (the common
/// case, anchored at the OS application-support dir) or [`Paths::with_root`]
/// (tests / explicit anchoring). Cheap to clone.
#[derive(Debug, Clone)]
pub struct Paths {
    root: PathBuf,
}

impl Paths {
    /// Resolve the app-support root `<app-support>/com.harmony.app/` and ensure
    /// it exists. Returns [`AppError::Io`] if the OS application-support dir is
    /// unavailable or the root cannot be created.
    pub fn app_support() -> AppResult<Self> {
        let base = dirs::data_dir().ok_or_else(|| {
            AppError::Io("could not resolve the OS application-support directory".to_string())
        })?;
        Self::with_root(base.join(BUNDLE_ID))
    }

    /// Anchor the resolver at an explicit root (must be the
    /// `com.harmony.app`-equivalent dir) and ensure it exists. Used by tests and
    /// any caller that wants a sandboxed layout.
    pub fn with_root(root: impl Into<PathBuf>) -> AppResult<Self> {
        let root = root.into();
        ensure_dir(&root)?;
        Ok(Self { root })
    }

    /// The app-support root dir (`…/com.harmony.app/`).
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The SQLite database file (`…/harmony.db`). Its parent (the root) is
    /// ensured; the file itself is created by the db layer (W3).
    pub fn db_file(&self) -> AppResult<PathBuf> {
        Ok(self.root.join(DB_FILE_NAME))
    }

    /// `config/` dir (created).
    pub fn config_dir(&self) -> AppResult<PathBuf> {
        self.subdir("config")
    }

    /// The app-config file (`config/app-config.json`); its parent is ensured.
    pub fn app_config_file(&self) -> AppResult<PathBuf> {
        Ok(self.config_dir()?.join(APP_CONFIG_FILE_NAME))
    }

    /// `cores/` dir (created) — installed libretro dylibs (§4.1).
    pub fn cores_dir(&self) -> AppResult<PathBuf> {
        self.subdir("cores")
    }

    /// `art-cache/` dir (created) — fetched boxart/title/snap (§4.1).
    pub fn art_cache_dir(&self) -> AppResult<PathBuf> {
        self.subdir("art-cache")
    }

    /// `blur-cache/` dir (created) — W10 pre-blurred heroes (§4.1).
    pub fn blur_cache_dir(&self) -> AppResult<PathBuf> {
        self.subdir("blur-cache")
    }

    /// `console-art/` dir (created) — v0.12 cached console photos from Wikipedia.
    pub fn console_art_dir(&self) -> AppResult<PathBuf> {
        self.subdir("console-art")
    }

    /// `logs/` dir (created) — telemetry / run logs (§4.1).
    pub fn logs_dir(&self) -> AppResult<PathBuf> {
        self.subdir("logs")
    }

    /// `saves/` dir (created) — battery SRAM + save states, one subdir per
    /// system (v0.23; docs/design/save-persistence-design.md §1).
    pub fn saves_dir(&self) -> AppResult<PathBuf> {
        self.subdir("saves")
    }

    /// Eagerly create every app-support subdirectory. Convenient for `setup`
    /// so the rest of the app can assume the full layout exists.
    pub fn ensure_all(&self) -> AppResult<()> {
        self.config_dir()?;
        self.cores_dir()?;
        self.art_cache_dir()?;
        self.blur_cache_dir()?;
        self.console_art_dir()?;
        self.logs_dir()?;
        self.saves_dir()?;
        Ok(())
    }

    // --- Deployed-instance layout (§4.2) ---

    /// The deployed-apps root `<base>/deployed-apps/harmony/` (created). By
    /// default anchored at the OS application-support base; `with_root` callers
    /// get a sibling `deployed-apps/` next to their explicit root for sandboxing.
    pub fn deployed_root(&self) -> AppResult<PathBuf> {
        let base = self
            .root
            .parent()
            .unwrap_or(&self.root)
            .join("deployed-apps")
            .join(DEPLOYED_APP_DIR);
        ensure_dir(&base)?;
        Ok(base)
    }

    /// `deployed-apps/harmony/versions/` (created).
    pub fn deployed_versions_dir(&self) -> AppResult<PathBuf> {
        let dir = self.deployed_root()?.join("versions");
        ensure_dir(&dir)?;
        Ok(dir)
    }

    /// A specific version dir `versions/{vX.Y.Z}/` (created).
    pub fn deployed_version_dir(&self, version: &str) -> AppResult<PathBuf> {
        let dir = self.deployed_versions_dir()?.join(version);
        ensure_dir(&dir)?;
        Ok(dir)
    }

    /// The `current` symlink path `deployed-apps/harmony/versions/current`.
    /// The path is returned regardless of whether the symlink exists yet (the
    /// release/fleet tooling, W11, plants it); its parent dir is ensured.
    pub fn deployed_current(&self) -> AppResult<PathBuf> {
        Ok(self.deployed_versions_dir()?.join("current"))
    }

    /// Resolve a subdir under the root, creating it.
    fn subdir(&self, name: &str) -> AppResult<PathBuf> {
        let dir = self.root.join(name);
        ensure_dir(&dir)?;
        Ok(dir)
    }
}

/// Idempotently create `dir` (and parents). Maps failures into [`AppError::Io`].
fn ensure_dir(dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `with_root` creates the root and the documented subdirs resolve beneath
    /// it with the contract names.
    #[test]
    fn app_support_subdirs_resolve_and_create() {
        let tmp = std::env::temp_dir().join(format!("harmony-paths-{}", std::process::id()));
        let paths = Paths::with_root(tmp.join(BUNDLE_ID)).expect("root");
        paths.ensure_all().expect("ensure all");

        assert!(paths.root().is_dir());
        assert_eq!(paths.db_file().unwrap().file_name().unwrap(), DB_FILE_NAME);
        assert!(paths.config_dir().unwrap().is_dir());
        assert!(paths.cores_dir().unwrap().is_dir());
        assert!(paths.art_cache_dir().unwrap().is_dir());
        assert!(paths.blur_cache_dir().unwrap().is_dir());
        assert!(paths.logs_dir().unwrap().is_dir());
        assert!(paths.root().ends_with(BUNDLE_ID));

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// The deployed layout resolves `versions/` + a specific version dir + the
    /// `current` symlink path (§4.2).
    #[test]
    fn deployed_layout_resolves() {
        let tmp = std::env::temp_dir().join(format!("harmony-deploy-{}", std::process::id()));
        let paths = Paths::with_root(tmp.join(BUNDLE_ID)).expect("root");

        let versions = paths.deployed_versions_dir().expect("versions");
        assert!(versions.is_dir());
        assert!(versions.ends_with("versions"));

        let v = paths.deployed_version_dir("v0.1.0").expect("version dir");
        assert!(v.is_dir());
        assert!(v.ends_with("v0.1.0"));

        let current = paths.deployed_current().expect("current");
        assert!(current.ends_with("current"));
        assert!(current.parent().unwrap().ends_with("versions"));

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn app_config_file_under_config_dir() {
        let tmp = std::env::temp_dir().join(format!("harmony-cfg-{}", std::process::id()));
        let paths = Paths::with_root(tmp.join(BUNDLE_ID)).expect("root");
        let f = paths.app_config_file().expect("config file");
        assert_eq!(f.file_name().unwrap(), APP_CONFIG_FILE_NAME);
        assert!(f.parent().unwrap().ends_with("config"));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
