//! GOG Galaxy game-source scanner (v0.32 W320 — see
//! `docs/design/non-retro-library-design.md` §GOG + itch scanners).
//!
//! Discovers installed GOG titles two ways, both purely local (no GOG API
//! calls, no Galaxy URL scheme dependency):
//!
//! 1. GOG Galaxy's local manifest records under `Galaxy DB/manifests`
//!    (one JSON file per installed title, written by the Galaxy client
//!    itself). This is the primary source when Galaxy has been used to
//!    install anything.
//! 2. A fallback/supplementary `.app`-bundle scan of the GOG games install
//!    root, for titles installed without going through the manifest records
//!    (or on a fresh manifest directory the client hasn't populated yet).
//!
//! Either or both may be absent — a missing manifest directory and/or a
//! missing install root simply contribute zero entries, never an error
//! (same "no Steam installed -> empty result" contract as `SteamScanner`).
//! Descriptor kind is always `app` (a GOG title is a `.app` bundle on
//! macOS), and bundles already claimed by the Steam or app scanners are
//! excluded (same dedup posture as `AppScanner`'s Steam exclusion, W313).

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{DiscoveredGame, GameSourceScanner};
use crate::db::repo::library::GameSource;
use crate::error::AppResult;

/// The subpath (under the user's home directory) holding GOG Galaxy's local
/// manifest records. Named rather than inlined so the scanner and its tests
/// share one definition of "where Galaxy keeps its manifests".
const GALAXY_MANIFESTS_SUBPATH: &str = "Library/Application Support/GOG.com/Galaxy DB/manifests";

/// The subpath (under the user's home directory) holding GOG Galaxy's
/// installed-games root on macOS.
const GALAXY_GAMES_SUBPATH: &str = "Library/Application Support/GOG.com/Galaxy/Games";

/// The subset of a Galaxy manifest JSON file's fields this scanner needs.
/// Galaxy's on-disk manifest schema carries many more fields (build ids,
/// dependencies, ...); `serde` simply ignores anything not named here.
#[derive(Debug, Deserialize)]
struct GalaxyManifest {
    /// GOG's numeric product id (e.g. `"1207658930"` for The Witcher 3), used
    /// as the dedup external id.
    #[serde(rename = "gameId", alias = "productId", alias = "id")]
    game_id: Option<String>,
    /// Display name (Galaxy manifests use "name" or "title" depending on
    /// version; both are accepted).
    #[serde(alias = "title")]
    name: Option<String>,
    /// Absolute path to the installed `.app` bundle (or the install
    /// directory containing it), if the manifest records one.
    #[serde(rename = "installPath", alias = "installDir")]
    install_path: Option<String>,
}

/// Scans GOG Galaxy's local records and/or install root for installed titles.
pub struct GogScanner {
    /// Directory of Galaxy manifest JSON files (parameterized for tests).
    manifests_dir: PathBuf,
    /// Directory under which installed `.app` bundles live (parameterized
    /// for tests).
    games_root: PathBuf,
}

impl GogScanner {
    /// Build a scanner rooted at explicit manifest/install directories (used
    /// by tests with tempdir fixtures).
    pub fn new(manifests_dir: impl Into<PathBuf>, games_root: impl Into<PathBuf>) -> Self {
        Self {
            manifests_dir: manifests_dir.into(),
            games_root: games_root.into(),
        }
    }

    /// Build a scanner rooted at the real per-user GOG Galaxy locations.
    pub fn default_location() -> Self {
        let home = dirs_home();
        Self::new(
            home.join(GALAXY_MANIFESTS_SUBPATH),
            home.join(GALAXY_GAMES_SUBPATH),
        )
    }

    /// Discover games from the Galaxy manifest directory. A missing
    /// directory yields an empty result, not an error.
    fn scan_manifests(&self) -> AppResult<Vec<DiscoveredGame>> {
        if !self.manifests_dir.is_dir() {
            return Ok(vec![]);
        }
        let mut games = Vec::new();
        for entry in std::fs::read_dir(&self.manifests_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue; // unreadable manifest — skip, don't fail the whole scan
            };
            let Ok(manifest) = serde_json::from_str::<GalaxyManifest>(&text) else {
                continue; // malformed manifest — skip
            };
            if let Some(game) = discovered_game_from_manifest(&manifest) {
                games.push(game);
            }
        }
        Ok(games)
    }

    /// Discover `.app` bundles directly under the Galaxy games install root
    /// that no manifest already accounted for. A missing root yields an
    /// empty result, not an error.
    fn scan_install_root(&self, already_discovered: &[DiscoveredGame]) -> AppResult<Vec<DiscoveredGame>> {
        let Ok(entries) = std::fs::read_dir(&self.games_root) else {
            return Ok(vec![]);
        };
        let mut games = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("app") {
                continue;
            }
            if is_steam_owned(&path) {
                continue;
            }
            let bundle_path_str = path.to_string_lossy().into_owned();
            let already_claimed = already_discovered
                .iter()
                .any(|g| bundle_path_matches(&g.launch_descriptor, &bundle_path_str));
            if already_claimed {
                continue;
            }
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Unknown".to_string());
            games.push(DiscoveredGame {
                name,
                source: GameSource::Gog,
                external_id: Some(bundle_path_str.clone()),
                launch_descriptor: serde_json::json!({
                    "kind": "app",
                    "bundle_path": bundle_path_str,
                }),
                art_hint: Some(bundle_path_str),
            });
        }
        Ok(games)
    }
}

/// Resolve the current user's home directory. Falls back to `/` only in the
/// unexpected case `$HOME` is unset, which simply makes the default scan
/// paths not exist (handled as the ordinary "no GOG Galaxy" empty-result case).
fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Whether `bundle_path` sits under a Steam-owned install tree, so the GOG
/// install-root scan excludes titles the Steam source already owns (same
/// dedup posture as `AppScanner`, W313).
fn is_steam_owned(bundle_path: &Path) -> bool {
    let lower = bundle_path.to_string_lossy().to_lowercase();
    lower.contains("/steam/steamapps/")
}

/// Whether an already-discovered game's `app`-kind launch descriptor points
/// at `bundle_path` — used to skip an install-root bundle a manifest already
/// produced a `DiscoveredGame` for.
fn bundle_path_matches(descriptor: &serde_json::Value, bundle_path: &str) -> bool {
    descriptor.get("bundle_path").and_then(|v| v.as_str()) == Some(bundle_path)
}

/// Build a `DiscoveredGame` from a parsed Galaxy manifest, or `None` if it is
/// missing a required field (game id or name), or names an empty/relative
/// `installPath` — such a manifest is treated as unparseable rather than
/// crashing the whole scan or producing an unlaunchable row (W334).
fn discovered_game_from_manifest(m: &GalaxyManifest) -> Option<DiscoveredGame> {
    let game_id = m.game_id.as_ref()?.clone();
    let name = m.name.as_ref()?.clone();
    let bundle_path = m.install_path.as_deref().filter(|p| is_launchable_path(p))?;
    Some(DiscoveredGame {
        name,
        source: GameSource::Gog,
        external_id: Some(game_id),
        launch_descriptor: serde_json::json!({
            "kind": "app",
            "bundle_path": bundle_path,
        }),
        art_hint: Some(bundle_path.to_string()),
    })
}

/// Whether `path` is non-empty and absolute — the minimum bar for a launch
/// path to ever resolve to a real, launchable install (W334: reject
/// empty/relative `installPath` at parse time rather than producing an
/// unlaunchable row).
fn is_launchable_path(path: &str) -> bool {
    !path.is_empty() && Path::new(path).is_absolute()
}

impl GameSourceScanner for GogScanner {
    fn scan(&self) -> AppResult<Vec<DiscoveredGame>> {
        let mut games = self.scan_manifests()?;
        let install_root_games = self.scan_install_root(&games)?;
        games.extend(install_root_games);
        Ok(games)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_manifest(dir: &Path, filename: &str, game_id: &str, name: &str, install_path: &str) {
        let contents = serde_json::json!({
            "gameId": game_id,
            "name": name,
            "installPath": install_path,
        });
        fs::write(dir.join(filename), contents.to_string()).unwrap();
    }

    fn write_bundle(root: &Path, app_name: &str) -> PathBuf {
        let bundle = root.join(app_name);
        fs::create_dir_all(bundle.join("Contents")).unwrap();
        bundle
    }

    #[test]
    fn parses_games_from_fixture_manifests() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        write_manifest(
            &manifests,
            "1207658930.json",
            "1207658930",
            "The Witcher 3: Wild Hunt",
            "/Applications/GOG Games/The Witcher 3.app",
        );

        let scanner = GogScanner::new(&manifests, &games_root);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "The Witcher 3: Wild Hunt");
        assert_eq!(games[0].source, GameSource::Gog);
        assert_eq!(games[0].external_id.as_deref(), Some("1207658930"));
        assert_eq!(games[0].launch_descriptor["kind"], "app");
    }

    #[test]
    fn accepts_the_alias_field_names() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        let contents = serde_json::json!({
            "productId": "1097893768",
            "title": "GWENT",
            "installDir": "/Applications/GOG Games/GWENT.app",
        });
        fs::write(manifests.join("1097893768.json"), contents.to_string()).unwrap();

        let scanner = GogScanner::new(&manifests, &games_root);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "GWENT");
        assert_eq!(games[0].external_id.as_deref(), Some("1097893768"));
    }

    #[test]
    fn missing_manifests_dir_and_games_root_is_empty_not_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let missing_manifests = tmp.path().join("does-not-exist-manifests");
        let missing_root = tmp.path().join("does-not-exist-games");

        let scanner = GogScanner::new(missing_manifests, missing_root);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty());
    }

    #[test]
    fn malformed_manifest_missing_required_fields_is_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        // No "name"/"title" field.
        fs::write(
            manifests.join("bad.json"),
            serde_json::json!({ "gameId": "999" }).to_string(),
        )
        .unwrap();
        write_manifest(&manifests, "good.json", "620", "Good Game", "/Applications/Good.app");

        let scanner = GogScanner::new(&manifests, &games_root);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].external_id.as_deref(), Some("620"));
    }

    #[test]
    fn manifest_with_empty_install_path_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        write_manifest(&manifests, "empty.json", "1", "Empty Path Game", "");

        let scanner = GogScanner::new(&manifests, &games_root);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty(), "an empty installPath must not produce an unlaunchable row");
    }

    #[test]
    fn manifest_with_relative_install_path_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        write_manifest(&manifests, "relative.json", "2", "Relative Path Game", "GOG Games/Relative.app");

        let scanner = GogScanner::new(&manifests, &games_root);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty(), "a relative installPath must not produce an unlaunchable row");
    }

    #[test]
    fn non_json_files_in_manifests_dir_are_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        write_manifest(&manifests, "good.json", "620", "Good Game", "/Applications/Good.app");
        fs::write(manifests.join("readme.txt"), "not a manifest").unwrap();

        let scanner = GogScanner::new(&manifests, &games_root);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
    }

    #[test]
    fn install_root_scan_discovers_unmanifested_bundles() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        write_bundle(&games_root, "Stray.app");

        let scanner = GogScanner::new(&manifests, &games_root);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Stray");
        assert_eq!(games[0].source, GameSource::Gog);
    }

    #[test]
    fn install_root_scan_does_not_duplicate_a_manifested_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        let bundle = write_bundle(&games_root, "GWENT.app");
        write_manifest(
            &manifests,
            "1097893768.json",
            "1097893768",
            "GWENT",
            &bundle.to_string_lossy(),
        );

        let scanner = GogScanner::new(&manifests, &games_root);
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1, "the manifest and install-root scan must not double-count the same bundle");
    }

    #[test]
    fn install_root_scan_excludes_steam_owned_bundles() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let steam_apps = tmp.path().join("Steam/steamapps/common/SomeGame");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&steam_apps).unwrap();
        write_bundle(&steam_apps, "SomeGame.app");

        let scanner = GogScanner::new(&manifests, &steam_apps);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty(), "Steam-owned bundles must be excluded");
    }

    #[test]
    fn rescan_of_same_fixtures_discovers_the_same_games_each_time() {
        let tmp = tempfile::tempdir().unwrap();
        let manifests = tmp.path().join("manifests");
        let games_root = tmp.path().join("Games");
        fs::create_dir_all(&manifests).unwrap();
        fs::create_dir_all(&games_root).unwrap();
        write_manifest(&manifests, "620.json", "620", "Portal 2", "/Applications/Portal2.app");

        let scanner = GogScanner::new(&manifests, &games_root);
        let first = scanner.scan().unwrap();
        let second = scanner.scan().unwrap();

        assert_eq!(first, second);
    }
}
