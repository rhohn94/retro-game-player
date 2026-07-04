//! Steam game-source scanner (v0.31 W312 "Frontier" — see
//! `docs/design/non-retro-library-design.md` §Game sources).
//!
//! Parses `appmanifest_*.acf` files (Valve's VDF text format) under a Steam
//! `steamapps` directory to discover installed titles. No Steam Web API
//! calls and no network access: this is a pure filesystem scan. A missing
//! Steam installation is not an error — it yields an empty result, since a
//! user without Steam installed should see zero rows, not a failure.

use super::{DiscoveredGame, GameSourceScanner};
use crate::db::repo::library::GameSource;
use crate::error::AppResult;
use serde_json::json;
use std::path::{Path, PathBuf};

/// The subpath (under the Steam install root) that holds `appmanifest_*.acf`
/// files. Named rather than inlined so both the scanner and its tests share
/// one definition of "where Steam keeps its manifests".
const STEAMAPPS_SUBPATH: &str = "Library/Application Support/Steam/steamapps";

// NOTE: `dirs_home()` returns e.g. `/Users/<user>`; joined with
// `STEAMAPPS_SUBPATH` this yields
// `/Users/<user>/Library/Application Support/Steam/steamapps`, matching the
// design doc's `~/Library/Application Support/Steam/steamapps`.

/// Scans a Steam `steamapps` directory for installed-game manifests.
pub struct SteamScanner {
    /// The `steamapps` directory to scan (parameterized for tests; production
    /// callers use [`SteamScanner::default_location`]).
    steamapps_dir: PathBuf,
}

impl SteamScanner {
    /// Build a scanner rooted at an explicit `steamapps` directory (used by
    /// tests with a tempdir fixture).
    pub fn new(steamapps_dir: impl Into<PathBuf>) -> Self {
        Self {
            steamapps_dir: steamapps_dir.into(),
        }
    }

    /// Build a scanner rooted at the real per-user Steam install location:
    /// `~/Library/Application Support/Steam/steamapps`.
    pub fn default_location() -> Self {
        let home = dirs_home();
        Self::new(home.join(STEAMAPPS_SUBPATH))
    }
}

/// Resolve the current user's home directory. Falls back to `/` only in the
/// unexpected case `$HOME` is unset, which simply makes the default scan
/// path not exist (handled as the ordinary "no Steam" empty-result case).
fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

impl GameSourceScanner for SteamScanner {
    fn scan(&self) -> AppResult<Vec<DiscoveredGame>> {
        if !self.steamapps_dir.is_dir() {
            // No Steam installed (or no games installed yet) — empty, not an error.
            return Ok(vec![]);
        }

        let mut games = Vec::new();
        let entries = std::fs::read_dir(&self.steamapps_dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if !is_appmanifest(&path) {
                continue;
            }
            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue, // unreadable manifest — skip, don't fail the whole scan
            };
            if let Some(manifest) = parse_appmanifest(&text) {
                games.push(discovered_game_from_manifest(&manifest));
            }
        }
        Ok(games)
    }
}

/// A manifest is any `appmanifest_*.acf` file directly inside `steamapps`.
fn is_appmanifest(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    name.starts_with("appmanifest_") && name.ends_with(".acf")
}

/// The subset of an `.acf` manifest's fields this scanner needs.
struct AppManifest {
    appid: String,
    name: String,
    #[allow(dead_code)] // parsed for completeness / future art-hint use; not read yet
    installdir: String,
}

fn discovered_game_from_manifest(m: &AppManifest) -> DiscoveredGame {
    DiscoveredGame {
        name: m.name.clone(),
        source: GameSource::Steam,
        external_id: Some(m.appid.clone()),
        launch_descriptor: json!({ "kind": "steam", "appid": m.appid }),
        art_hint: Some(m.appid.clone()),
    }
}

/// Parse the `appid`, `name`, and `installdir` fields out of an `.acf`
/// manifest's VDF text. VDF is Valve's simple `"key"    "value"` text format;
/// we only need a handful of top-level scalar fields, so this is a small
/// line-oriented parser rather than a full VDF grammar (nested blocks like
/// `"UserConfig"` are irrelevant here and simply don't match any key we
/// look for). Returns `None` if either required field (`appid` or `name`) is
/// missing — such a manifest is treated as unparseable rather than crashing
/// the whole scan.
fn parse_appmanifest(text: &str) -> Option<AppManifest> {
    let mut appid = None;
    let mut name = None;
    let mut installdir = String::new();

    for line in text.lines() {
        if let Some((key, value)) = parse_vdf_kv_line(line) {
            match key.as_str() {
                "appid" => appid = Some(value),
                "name" => name = Some(value),
                "installdir" => installdir = value,
                _ => {}
            }
        }
    }

    // A Steam appid is always a decimal number. Rejecting anything else here
    // is a security boundary, not cosmetics: the appid becomes an art-cache
    // FILENAME component and a CDN URL segment downstream, so a crafted
    // manifest (e.g. `"appid" "../../x"`) must never survive the parse.
    let appid = appid.filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))?;

    Some(AppManifest {
        appid,
        name: name?,
        installdir,
    })
}

/// Parse one VDF line of the form `"key"    "value"` (arbitrary whitespace
/// between the two quoted tokens). Returns `None` for lines that aren't a
/// quoted key/value pair (braces, comments, blank lines, nested-block
/// openers).
fn parse_vdf_kv_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if !trimmed.starts_with('"') {
        return None;
    }
    let mut parts = split_quoted_tokens(trimmed);
    let key = parts.next()?;
    let value = parts.next()?;
    Some((key, value))
}

/// Split a line into its quoted (`"..."`) tokens, ignoring everything between
/// them (whitespace or, for a key/value line, nothing at all).
fn split_quoted_tokens(line: &str) -> impl Iterator<Item = String> + '_ {
    let mut rest = line;
    std::iter::from_fn(move || {
        let start = rest.find('"')?;
        let after_start = &rest[start + 1..];
        let end = after_start.find('"')?;
        let token = after_start[..end].to_string();
        rest = &after_start[end + 1..];
        Some(token)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_manifest(dir: &Path, filename: &str, appid: &str, name: &str, installdir: &str) {
        let contents = format!(
            "\"AppState\"\n{{\n\t\"appid\"\t\t\"{appid}\"\n\t\"name\"\t\t\"{name}\"\n\t\"installdir\"\t\t\"{installdir}\"\n\t\"StateFlags\"\t\t\"4\"\n}}\n"
        );
        fs::write(dir.join(filename), contents).unwrap();
    }

    #[test]
    fn parses_name_and_appid_from_fixture_acf_files() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "appmanifest_620.acf", "620", "Portal 2", "Portal 2");
        write_manifest(tmp.path(), "appmanifest_400.acf", "400", "Portal", "Portal");

        let scanner = SteamScanner::new(tmp.path());
        let mut games = scanner.scan().unwrap();
        games.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(games.len(), 2);
        assert_eq!(games[0].name, "Portal");
        assert_eq!(games[0].external_id.as_deref(), Some("400"));
        assert_eq!(games[1].name, "Portal 2");
        assert_eq!(games[1].external_id.as_deref(), Some("620"));
    }

    /// The appid guard is a security boundary (the appid becomes an art-cache
    /// filename component and a CDN URL segment downstream): manifests whose
    /// appid is not purely numeric — e.g. a crafted `"../../x"` traversal
    /// payload — must be dropped at parse time like any other malformed file.
    #[test]
    fn rejects_manifests_with_non_numeric_appids() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "appmanifest_620.acf", "620", "Portal 2", "Portal 2");
        write_manifest(tmp.path(), "appmanifest_evil.acf", "../../x", "Evil", "Evil");
        write_manifest(tmp.path(), "appmanifest_blank.acf", "", "Blank", "Blank");
        write_manifest(tmp.path(), "appmanifest_alpha.acf", "12a4", "Alpha", "Alpha");

        let scanner = SteamScanner::new(tmp.path());
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].external_id.as_deref(), Some("620"));
    }

    #[test]
    fn discovered_game_has_steam_source_and_descriptor() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "appmanifest_620.acf", "620", "Portal 2", "Portal 2");

        let scanner = SteamScanner::new(tmp.path());
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].source, GameSource::Steam);
        assert_eq!(games[0].art_hint.as_deref(), Some("620"));
        assert_eq!(
            games[0].launch_descriptor,
            json!({ "kind": "steam", "appid": "620" })
        );
    }

    #[test]
    fn ignores_non_manifest_files_in_steamapps_dir() {
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "appmanifest_620.acf", "620", "Portal 2", "Portal 2");
        fs::write(tmp.path().join("libraryfolders.vdf"), "\"libraryfolders\"\n{\n}\n").unwrap();
        fs::create_dir(tmp.path().join("common")).unwrap();

        let scanner = SteamScanner::new(tmp.path());
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Portal 2");
    }

    #[test]
    fn missing_steamapps_dir_is_empty_not_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("does-not-exist");

        let scanner = SteamScanner::new(missing);
        let games = scanner.scan().unwrap();

        assert!(games.is_empty());
    }

    #[test]
    fn malformed_manifest_missing_required_fields_is_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        // No "name" field — unparseable, should be skipped rather than error.
        fs::write(
            tmp.path().join("appmanifest_999.acf"),
            "\"AppState\"\n{\n\t\"appid\"\t\t\"999\"\n}\n",
        )
        .unwrap();
        write_manifest(tmp.path(), "appmanifest_620.acf", "620", "Portal 2", "Portal 2");

        let scanner = SteamScanner::new(tmp.path());
        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].external_id.as_deref(), Some("620"));
    }

    #[test]
    fn rescan_of_same_fixtures_discovers_the_same_games_each_time() {
        // The scanner itself is a pure read — the dedup/idempotency contract
        // is enforced by `upsert_game_by_source` (see db/repo/library.rs), but
        // this confirms the scanner is deterministic across repeated scans.
        let tmp = tempfile::tempdir().unwrap();
        write_manifest(tmp.path(), "appmanifest_620.acf", "620", "Portal 2", "Portal 2");

        let scanner = SteamScanner::new(tmp.path());
        let first = scanner.scan().unwrap();
        let second = scanner.scan().unwrap();

        assert_eq!(first, second);
    }
}
