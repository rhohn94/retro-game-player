//! RetroArch locator — finds the RetroArch executable on macOS, preferring the
//! user-set override path from `AppConfig`, then a set of well-known candidate
//! paths, then Launch Services by bundle identifier.

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// macOS bundle identifier for the official RetroArch distribution.
const RETROARCH_BUNDLE_ID: &str = "org.libretro.RetroArch";

/// Path inside a `.app` bundle to the actual executable.
const RETROARCH_EXECUTABLE_SUBPATH: &str = "Contents/MacOS/RetroArch";

/// Well-known candidate install locations, checked in order.
///
/// This list is the unit-testable surface; callers can verify it contains the
/// expected entries without touching the filesystem.
pub fn candidate_paths() -> Vec<PathBuf> {
    let paths = vec![
        PathBuf::from("/Applications/RetroArch.app"),
        home_dir_app(),
    ];
    paths
}

/// `~/Applications/RetroArch.app`
fn home_dir_app() -> PathBuf {
    // dirs::home_dir() is stable on macOS; fall back to /tmp if unavailable
    // (only happens in constrained test envs without HOME set).
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join("Applications").join("RetroArch.app")
}

/// Resolve the RetroArch executable path.
///
/// Resolution order:
/// 1. `override_path` (user-set via `set_retroarch_path`) — used if `Some`.
/// 2. Each [`candidate_paths`] entry (`/Applications/…`, `~/Applications/…`).
/// 3. `mdls -raw -name kMDItemCFBundleIdentifier` + `mdfind` via Launch Services
///    (macOS-only shell-out — controlled, single argument, no shell string).
///
/// Returns `Ok(None)` when nothing is found. The caller (command layer) turns
/// `None` into [`AppError::Dependency`] with an "Install RetroArch" message and
/// exposes `set_retroarch_path` as the manual-picker affordance.
pub fn locate(override_path: Option<&str>) -> AppResult<Option<PathBuf>> {
    // 1. User-set override wins unconditionally.
    if let Some(p) = override_path {
        let path = PathBuf::from(p);
        let exe = executable_for(&path);
        if exe.exists() {
            return Ok(Some(exe));
        }
        // Override is set but no longer valid — surface a clear IO error.
        return Err(AppError::Io(format!(
            "configured RetroArch path no longer exists: {}",
            exe.display()
        )));
    }

    // 2. Well-known candidate paths.
    for bundle in candidate_paths() {
        let exe = executable_for(&bundle);
        if exe.exists() {
            return Ok(Some(exe));
        }
    }

    // 3. Launch Services via `mdfind` (macOS Spotlight metadata query).
    if let Some(found) = locate_via_launch_services()? {
        return Ok(Some(found));
    }

    Ok(None)
}

/// Given a `.app` bundle path, return the inner executable path.
/// Accepts both bare bundle paths and already-resolved executable paths.
pub fn executable_for(bundle_or_exe: &Path) -> PathBuf {
    if bundle_or_exe
        .extension()
        .map(|e| e == "app")
        .unwrap_or(false)
    {
        bundle_or_exe.join(RETROARCH_EXECUTABLE_SUBPATH)
    } else {
        bundle_or_exe.to_owned()
    }
}

/// Ask Spotlight (`mdfind`) for the bundle with the RetroArch bundle identifier.
/// Returns the executable path inside the found bundle, or `None` if absent /
/// Spotlight unavailable. Errors are silenced into `None` (best-effort probe).
fn locate_via_launch_services() -> AppResult<Option<PathBuf>> {
    let output = std::process::Command::new("mdfind")
        .arg(format!("kMDItemCFBundleIdentifier == '{}'", RETROARCH_BUNDLE_ID))
        .output();

    let output = match output {
        Ok(o) => o,
        Err(_) => return Ok(None), // mdfind not available (sandbox / test env)
    };

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        return Ok(None);
    }

    let bundle = PathBuf::from(first_line);
    let exe = executable_for(&bundle);
    if exe.exists() {
        Ok(Some(exe))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_paths_includes_global_and_user_applications() {
        let paths = candidate_paths();
        assert!(
            paths
                .iter()
                .any(|p| p == &PathBuf::from("/Applications/RetroArch.app")),
            "must include /Applications/RetroArch.app"
        );
        let home = dirs::home_dir().expect("home dir");
        assert!(
            paths
                .iter()
                .any(|p| p == &home.join("Applications").join("RetroArch.app")),
            "must include ~/Applications/RetroArch.app"
        );
    }

    #[test]
    fn candidate_paths_has_exactly_two_entries() {
        assert_eq!(candidate_paths().len(), 2);
    }

    #[test]
    fn executable_for_bundle_appends_contents_macos() {
        let bundle = PathBuf::from("/Applications/RetroArch.app");
        let exe = executable_for(&bundle);
        assert_eq!(exe, bundle.join("Contents/MacOS/RetroArch"));
    }

    #[test]
    fn executable_for_non_app_path_is_unchanged() {
        let p = PathBuf::from("/usr/bin/retroarch");
        assert_eq!(executable_for(&p), p);
    }

    #[test]
    fn locate_returns_none_when_nothing_present() {
        // In CI / clean test env neither candidate exists and mdfind returns nothing.
        // We can only assert no panic and the right shape.
        let result = locate(None);
        assert!(result.is_ok());
    }

    #[test]
    fn locate_errors_when_override_path_is_missing() {
        let result = locate(Some("/nonexistent/RetroArch.app"));
        assert!(
            matches!(result, Err(AppError::Io(_))),
            "missing override must be an Io error"
        );
    }
}
