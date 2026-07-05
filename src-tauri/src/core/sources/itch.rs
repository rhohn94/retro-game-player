//! itch game-source scanner (v0.32 W320 — see
//! `docs/design/non-retro-library-design.md` §GOG + itch scanners).
//!
//! Discovers installed itch titles two ways, both purely local (no itch.io
//! API calls):
//!
//! 1. The itch app's local install receipts under `itch/receipts` (one JSON
//!    file per install, written by `butler`/the itch app itself), naming
//!    each install's game id, title, and launch target.
//! 2. A fallback scan of the itch apps install directory for installs no
//!    receipt accounts for, treating each top-level entry as either an
//!    `.app` bundle (descriptor `app`) or a bare executable (descriptor
//!    `exec`).
//!
//! Either or both may be absent — a missing receipts directory and/or a
//! missing install root simply contribute zero entries, never an error
//! (same "no itch installed -> empty result" contract as `SteamScanner` /
//! `GogScanner`). Bundles already claimed by the Steam or app scanners are
//! excluded (same dedup posture as `AppScanner`'s Steam exclusion, W313).

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{DiscoveredGame, GameSourceScanner};
use crate::db::repo::library::GameSource;
use crate::error::AppResult;

/// The subpath (under the user's home directory) holding itch's local
/// install receipts.
const ITCH_RECEIPTS_SUBPATH: &str = "Library/Application Support/itch/receipts";

/// The subpath (under the user's home directory) holding itch's installed-
/// apps root on macOS.
const ITCH_APPS_SUBPATH: &str = "Library/Application Support/itch/apps";

/// The subset of an itch install receipt JSON file's fields this scanner
/// needs. `serde` ignores any field not named here.
#[derive(Debug, Deserialize)]
struct ItchReceipt {
    /// itch's game id (numeric) or a `user/game` slug, used as the dedup
    /// external id.
    #[serde(rename = "gameId", alias = "id")]
    game_id: Option<String>,
    /// Display title.
    #[serde(alias = "name")]
    title: Option<String>,
    /// Absolute path to the launch target: an `.app` bundle or a bare
    /// executable.
    #[serde(rename = "installPath", alias = "executablePath", alias = "launchTarget")]
    launch_path: Option<String>,
}

/// Scans itch's local install receipts and/or apps root for installed titles.
pub struct ItchScanner {
    /// Directory of install receipt JSON files (parameterized for tests).
    receipts_dir: PathBuf,
    /// Directory under which installed apps/executables live (parameterized
    /// for tests).
    apps_root: PathBuf,
}

impl ItchScanner {
    /// Build a scanner rooted at explicit receipts/apps directories (used by
    /// tests with tempdir fixtures).
    pub fn new(receipts_dir: impl Into<PathBuf>, apps_root: impl Into<PathBuf>) -> Self {
        Self {
            receipts_dir: receipts_dir.into(),
            apps_root: apps_root.into(),
        }
    }

    /// Build a scanner rooted at the real per-user itch locations.
    pub fn default_location() -> Self {
        let home = dirs_home();
        Self::new(home.join(ITCH_RECEIPTS_SUBPATH), home.join(ITCH_APPS_SUBPATH))
    }

    /// Discover games from the receipts directory. A missing directory
    /// yields an empty result, not an error.
    fn scan_receipts(&self) -> AppResult<Vec<DiscoveredGame>> {
        if !self.receipts_dir.is_dir() {
            return Ok(vec![]);
        }
        let mut games = Vec::new();
        for entry in std::fs::read_dir(&self.receipts_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue; // unreadable receipt — skip, don't fail the whole scan
            };
            let Ok(receipt) = serde_json::from_str::<ItchReceipt>(&text) else {
                continue; // malformed receipt — skip
            };
            if let Some(game) = discovered_game_from_receipt(&receipt) {
                games.push(game);
            }
        }
        Ok(games)
    }

    /// Discover top-level installs directly under the itch apps root that no
    /// receipt already accounted for. A missing root yields an empty result,
    /// not an error. Each entry is classified `app` (an `.app` bundle) or
    /// `exec` (a regular file with the executable bit set) — anything else
    /// (a plain data file, a non-bundle subdirectory) is neither launchable
    /// nor a bundle, so it is skipped rather than mis-classified as `exec`
    /// (W334: a data file/subdir must never become an unlaunchable row).
    fn scan_install_dir(&self, already_discovered: &[DiscoveredGame]) -> AppResult<Vec<DiscoveredGame>> {
        let Ok(entries) = std::fs::read_dir(&self.apps_root) else {
            return Ok(vec![]);
        };
        let mut games = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if is_steam_owned(&path) {
                continue;
            }
            let is_app_bundle = path.extension().and_then(|e| e.to_str()) == Some("app");
            if !is_app_bundle && !is_executable_file(&path) {
                continue;
            }
            let launch_path_str = path.to_string_lossy().into_owned();
            let already_claimed = already_discovered
                .iter()
                .any(|g| launch_path_matches(&g.launch_descriptor, &launch_path_str));
            if already_claimed {
                continue;
            }
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Unknown".to_string());
            let launch_descriptor = if is_app_bundle {
                serde_json::json!({ "kind": "app", "bundle_path": launch_path_str })
            } else {
                serde_json::json!({ "kind": "exec", "program": launch_path_str, "args": Vec::<String>::new() })
            };
            games.push(DiscoveredGame {
                name,
                source: GameSource::Itch,
                external_id: Some(launch_path_str.clone()),
                launch_descriptor,
                art_hint: if is_app_bundle { Some(launch_path_str) } else { None },
            });
        }
        Ok(games)
    }
}

/// Resolve the current user's home directory. Falls back to `/` only in the
/// unexpected case `$HOME` is unset, which simply makes the default scan
/// paths not exist (handled as the ordinary "no itch installed" empty-result
/// case).
fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Whether `path` is a regular file with at least one executable bit set —
/// the only filesystem shape the install-dir fallback classifies as `exec`
/// (W334). A data file or a bare directory (neither a regular file nor
/// executable) is skipped rather than turned into an unlaunchable row.
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
}

/// Whether `install_path` sits under a Steam-owned install tree, so the itch
/// install-dir scan excludes titles the Steam source already owns (same
/// dedup posture as `AppScanner`/`GogScanner`, W313/W320).
fn is_steam_owned(install_path: &Path) -> bool {
    let lower = install_path.to_string_lossy().to_lowercase();
    lower.contains("/steam/steamapps/")
}

/// Whether an already-discovered game's launch descriptor points at
/// `launch_path` (either an `app`'s `bundle_path` or an `exec`'s `program`) —
/// used to skip an install-dir entry a receipt already produced a
/// `DiscoveredGame` for.
fn launch_path_matches(descriptor: &serde_json::Value, launch_path: &str) -> bool {
    let target = descriptor
        .get("bundle_path")
        .or_else(|| descriptor.get("program"))
        .and_then(|v| v.as_str());
    target == Some(launch_path)
}

/// Build a `DiscoveredGame` from a parsed itch receipt, or `None` if it is
/// missing a required field (game id or title), or names an empty/relative
/// `installPath` — such a receipt is treated as unparseable rather than
/// crashing the whole scan or producing an unlaunchable row (W334).
fn discovered_game_from_receipt(r: &ItchReceipt) -> Option<DiscoveredGame> {
    let game_id = r.game_id.as_ref()?.clone();
    let title = r.title.as_ref()?.clone();
    let launch_path = r.launch_path.as_deref().filter(|p| is_launchable_path(p))?;
    let is_app_bundle = launch_path.ends_with(".app");
    let launch_descriptor = if is_app_bundle {
        serde_json::json!({ "kind": "app", "bundle_path": launch_path })
    } else {
        serde_json::json!({ "kind": "exec", "program": launch_path, "args": Vec::<String>::new() })
    };
    Some(DiscoveredGame {
        name: title,
        source: GameSource::Itch,
        external_id: Some(game_id),
        launch_descriptor,
        art_hint: if is_app_bundle {
            Some(launch_path.to_string())
        } else {
            None
        },
    })
}

/// Whether `path` is non-empty and absolute — the minimum bar for a launch
/// path to ever resolve to a real, launchable install (W334: reject
/// empty/relative `installPath` at parse time rather than producing an
/// unlaunchable row).
fn is_launchable_path(path: &str) -> bool {
    !path.is_empty() && Path::new(path).is_absolute()
}

impl GameSourceScanner for ItchScanner {
    fn scan(&self) -> AppResult<Vec<DiscoveredGame>> {
        let mut games = self.scan_receipts()?;
        let install_dir_games = self.scan_install_dir(&games)?;
        games.extend(install_dir_games);
        Ok(games)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_receipt(dir: &Path, filename: &str, game_id: &str, title: &str, launch_path: &str) {
        let contents = serde_json::json!({
            "gameId": game_id,
            "title": title,
            "installPath": launch_path,
        });
        fs::write(dir.join(filename), contents.to_string()).unwrap();
    }

    fn write_bundle(root: &Path, app_name: &str) -> PathBuf {
        let bundle = root.join(app_name);
        fs::create_dir_all(bundle.join("Contents")).unwrap();
        bundle
    }

    fn write_exec(root: &Path, exe_name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let exe = root.join(exe_name);
        fs::write(&exe, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();
        exe
    }

    /// A regular file with no executable bit set — e.g. a data file the itch
    /// apps root happens to contain alongside real installs.
    fn write_data_file(root: &Path, filename: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let file = root.join(filename);
        fs::write(&file, "not launchable").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        file
    }

    #[test]
    fn parses_games_from_fixture_receipts() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        write_receipt(
            &receipts,
            "celeste.json",
            "user/celeste",
            "Celeste",
            "/Applications/Celeste.app",
        );

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Celeste");
        assert_eq!(games[0].source, GameSource::Itch);
        assert_eq!(games[0].external_id.as_deref(), Some("user/celeste"));
        assert_eq!(games[0].launch_descriptor["kind"], "app");
    }

    #[test]
    fn a_non_app_launch_path_yields_an_exec_descriptor() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        write_receipt(
            &receipts,
            "towerfall.json",
            "user/towerfall",
            "TowerFall",
            "/Users/me/itch/towerfall/towerfall-bin",
        );

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].launch_descriptor["kind"], "exec");
        assert_eq!(
            games[0].launch_descriptor["program"],
            "/Users/me/itch/towerfall/towerfall-bin"
        );
    }

    #[test]
    fn accepts_the_alias_field_names() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        let contents = serde_json::json!({
            "id": "12345",
            "name": "Chess Game",
            "executablePath": "/Applications/Chess Game.app",
        });
        fs::write(receipts.join("chess.json"), contents.to_string()).unwrap();

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Chess Game");
        assert_eq!(games[0].external_id.as_deref(), Some("12345"));
    }

    #[test]
    fn missing_receipts_dir_and_apps_root_is_empty_not_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let missing_receipts = tmp.path().join("does-not-exist-receipts");
        let missing_apps = tmp.path().join("does-not-exist-apps");

        let scanner = ItchScanner::new(missing_receipts, missing_apps);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty());
    }

    #[test]
    fn malformed_receipt_missing_required_fields_is_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        // No "title"/"name" field.
        fs::write(
            receipts.join("bad.json"),
            serde_json::json!({ "gameId": "999" }).to_string(),
        )
        .unwrap();
        write_receipt(&receipts, "good.json", "620", "Good Game", "/Applications/Good.app");

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].external_id.as_deref(), Some("620"));
    }

    #[test]
    fn receipt_with_empty_install_path_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        write_receipt(&receipts, "empty.json", "1", "Empty Path Game", "");

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty(), "an empty installPath must not produce an unlaunchable row");
    }

    #[test]
    fn receipt_with_relative_install_path_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        write_receipt(&receipts, "relative.json", "2", "Relative Path Game", "itch/relative-bin");

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty(), "a relative installPath must not produce an unlaunchable row");
    }

    #[test]
    fn non_json_files_in_receipts_dir_are_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        write_receipt(&receipts, "good.json", "620", "Good Game", "/Applications/Good.app");
        fs::write(receipts.join("readme.txt"), "not a receipt").unwrap();

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
    }

    #[test]
    fn install_dir_scan_discovers_unreceipted_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        write_bundle(&apps, "Downwell.app");

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Downwell");
        assert_eq!(games[0].launch_descriptor["kind"], "app");
    }

    #[test]
    fn install_dir_scan_discovers_unreceipted_bare_executable() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        write_exec(&apps, "spelunky");

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].launch_descriptor["kind"], "exec");
    }

    #[test]
    fn install_dir_scan_skips_non_executable_data_files_and_plain_subdirs() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        // A non-executable data file (e.g. a README or manifest) ...
        write_data_file(&apps, "README.txt");
        // ... and a bare (non-`.app`) subdirectory, e.g. leftover cache dir.
        fs::create_dir_all(apps.join("cache")).unwrap();
        // ... alongside one real, executable install that must still surface.
        write_exec(&apps, "spelunky");

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(
            games.len(),
            1,
            "data files and non-bundle subdirs must never become unlaunchable rows"
        );
        assert_eq!(games[0].launch_descriptor["kind"], "exec");
        assert!(games[0].launch_descriptor["program"]
            .as_str()
            .unwrap()
            .ends_with("spelunky"));
    }

    #[test]
    fn install_dir_scan_does_not_duplicate_a_receipted_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        let bundle = write_bundle(&apps, "Celeste.app");
        write_receipt(&receipts, "celeste.json", "user/celeste", "Celeste", &bundle.to_string_lossy());

        let scanner = ItchScanner::new(&receipts, &apps);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1, "the receipt and install-dir scan must not double-count the same install");
    }

    #[test]
    fn install_dir_scan_excludes_steam_owned_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let steam_apps = tmp.path().join("Steam/steamapps/common/SomeGame");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&steam_apps).unwrap();
        write_bundle(&steam_apps, "SomeGame.app");

        let scanner = ItchScanner::new(&receipts, &steam_apps);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty(), "Steam-owned installs must be excluded");
    }

    #[test]
    fn rescan_of_same_fixtures_discovers_the_same_games_each_time() {
        let tmp = tempfile::tempdir().unwrap();
        let receipts = tmp.path().join("receipts");
        let apps = tmp.path().join("apps");
        fs::create_dir_all(&receipts).unwrap();
        fs::create_dir_all(&apps).unwrap();
        write_receipt(&receipts, "620.json", "620", "Some Game", "/Applications/Some.app");

        let scanner = ItchScanner::new(&receipts, &apps);
        let first = scanner.scan().unwrap();
        let second = scanner.scan().unwrap();

        assert_eq!(first, second);
    }
}
