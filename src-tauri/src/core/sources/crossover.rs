//! CrossOver game-source scanner (v0.33 W331 — see
//! `docs/design/crossover-integration-design.md` §Detection, §Enumeration).
//!
//! CrossOver is a user-installed prerequisite (RGP never ships, patches, or
//! configures Wine — same boundary as RetroArch); this scanner only reads
//! plain files CrossOver itself already wrote to disk. No CrossOver process
//! is launched or queried.
//!
//! **Detection:** CrossOver is considered present when either exists:
//! `/Applications/CrossOver.app` (or `~/Applications/CrossOver.app`), or the
//! bottle root `~/Library/Application Support/CrossOver/Bottles/`. Absence of
//! both yields a clean zero-count scan, never an error (same contract as
//! every other [`super::GameSourceScanner`]).
//!
//! **Enumeration** has two complementary halves:
//!
//! 1. **Bottle inventory** — each `Bottles/<name>/` directory containing a
//!    `cxbottle.conf` is one bottle; the directory name is its stable id.
//! 2. **Installed apps per bottle** — primarily the macOS launcher stub
//!    bundles CrossOver generates under
//!    `~/Applications/CrossOver/<Bottle>/<App>.app` (name from the bundle,
//!    `art_hint` = the stub path, feeding the existing bundle-icon art rung —
//!    W314/W321, no new art machinery). Where a bottle has no stub
//!    directory, this falls back to reading `.cxmenu` link records under the
//!    bottle's `drive_c/users/crossover/Desktop`; an entry the fallback can't
//!    classify is skipped (never fails the whole scan).
//!
//! **Fixture-assumption caveat (design doc, authoritative):** `cxbottle.conf`
//! field names and the `.cxmenu` link-record shape are encoded here from the
//! checked-in test fixtures under `tests fixtures` in this module — no real
//! CrossOver install was available to validate them against. Real-install
//! validation is tracked as a design-doc follow-up
//! (`docs/design/crossover-integration-design.md` §Follow-ups).
//!
//! Row shape (design doc §Enumeration): `source = "crossover"`,
//! `external_id = "<bottle>/<app-key>"` (stable across re-scans, dedup key).
//! Launcher-stub bundles live only under `~/Applications/CrossOver/`, so they
//! cannot overlap the Steam/app/GOG/itch scanners' claimed trees; asserted by
//! a fixture test anyway.
//!
//! **Launch-descriptor shape produced here (W331 only documents/emits it —
//! W332 implements the launcher):**
//! - Stub exists: `{ "kind": "app", "bundle_path": "<stub .app path>" }` —
//!   identical shape to every other app-launched source, so it reuses the
//!   `app` launcher unmodified once W332 lands.
//! - No stub (link-record fallback only): `{ "kind": "crossover", "bottle":
//!   "<bottle id>", "target": "<link target path from the .cxmenu record>" }`
//!   — a new descriptor kind `core/launch` does not yet interpret; W332 adds
//!   that.

use std::collections::HashMap;
use std::path::PathBuf;

use super::{DiscoveredGame, GameSourceScanner};
use crate::db::repo::library::GameSource;
use crate::error::AppResult;

/// The subpath (under the user's home directory) holding CrossOver's bottle
/// root — authoritative for enumeration (design doc: "configurable roots are
/// a follow-up").
const BOTTLES_SUBPATH: &str = "Library/Application Support/CrossOver/Bottles";

/// The subpath (under the user's home directory) holding CrossOver's
/// generated macOS launcher-stub bundles, one subdirectory per bottle.
const LAUNCHER_STUBS_SUBPATH: &str = "Applications/CrossOver";

/// The bottle-relative path to the Windows desktop CrossOver mirrors
/// `.cxmenu` link records under, used as the stub-less fallback.
const BOTTLE_DESKTOP_SUBPATH: &str = "drive_c/users/crossover/Desktop";

/// The bottle inventory file whose presence marks a `Bottles/<name>/`
/// directory as an actual bottle (vs. stray non-bottle content).
const BOTTLE_CONF_FILENAME: &str = "cxbottle.conf";

/// One parsed `cxbottle.conf` — only the fields this scanner needs. Real
/// CrossOver installs were not available to validate these names against;
/// they are fixture assumptions (design doc §Enumeration caveat) encoded in
/// `crossover_fixtures` and re-derived here from CrossOver's publicly
/// documented bottle-config conventions. A missing/unparseable file still
/// yields a bottle (identified by directory name alone) — display-name is
/// cosmetic, never required for enumeration to proceed.
#[derive(Debug, Default, PartialEq)]
struct BottleConf {
    /// Human-readable bottle name, if the conf overrides the directory name.
    display_name: Option<String>,
    /// The Windows/template profile the bottle was created from (e.g.
    /// `win10`), if present. Not currently surfaced to the UI, but parsed so
    /// a future UI affordance doesn't need to touch this parser again.
    template: Option<String>,
}

/// One `.cxmenu` desktop-link record — the stub-less fallback's source of a
/// launch target. `.cxmenu` files are a CrossOver-specific plain-text
/// key=value format (not INI sections); fixture-assumed shape (design doc
/// caveat): a `Name=` line and a `Target=` (or `Exec=`) line giving the
/// Windows-side path CrossOver would launch. A record missing a name or
/// target cannot be classified and is skipped (design doc: "skipped
/// per-entry, never fail the scan").
#[derive(Debug, Default, PartialEq)]
struct CxMenuLink {
    name: Option<String>,
    target: Option<String>,
}

/// Scans CrossOver's bottle root and launcher-stub tree for installed
/// Windows applications, one [`DiscoveredGame`] per app.
pub struct CrossoverScanner {
    /// Locations whose existence alone signals "CrossOver is installed"
    /// (the `.app` bundle locations); parameterized for tests.
    app_bundle_candidates: Vec<PathBuf>,
    /// The bottle root directory (parameterized for tests).
    bottles_root: PathBuf,
    /// The launcher-stub root directory, one subdirectory per bottle
    /// (parameterized for tests).
    launcher_stubs_root: PathBuf,
}

impl CrossoverScanner {
    /// Build a scanner rooted at explicit locations (used by tests with
    /// tempdir fixtures).
    pub fn new(
        app_bundle_candidates: Vec<PathBuf>,
        bottles_root: impl Into<PathBuf>,
        launcher_stubs_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            app_bundle_candidates,
            bottles_root: bottles_root.into(),
            launcher_stubs_root: launcher_stubs_root.into(),
        }
    }

    /// Build a scanner rooted at the real per-user/system CrossOver
    /// locations.
    pub fn default_location() -> Self {
        let home = dirs_home();
        let mut app_bundle_candidates = vec![PathBuf::from("/Applications/CrossOver.app")];
        app_bundle_candidates.push(home.join("Applications/CrossOver.app"));
        Self::new(
            app_bundle_candidates,
            home.join(BOTTLES_SUBPATH),
            home.join(LAUNCHER_STUBS_SUBPATH),
        )
    }

    /// Whether CrossOver is present at all (design doc §Detection): either
    /// app-bundle candidate exists, or the bottle root exists. Detection
    /// never launches or queries a running CrossOver.
    fn is_crossover_present(&self) -> bool {
        self.app_bundle_candidates.iter().any(|p| p.is_dir()) || self.bottles_root.is_dir()
    }

    /// Enumerate every bottle directory under the bottle root — a
    /// `Bottles/<name>/` directory counts only if it contains a
    /// `cxbottle.conf` (design doc §Enumeration point 1). Returns
    /// `(bottle_id, parsed_conf)` pairs; a missing/unparseable conf still
    /// yields the bottle with a default (empty) conf, since the directory
    /// name alone is enough identity to enumerate its apps.
    fn list_bottles(&self) -> Vec<(String, BottleConf)> {
        let Ok(entries) = std::fs::read_dir(&self.bottles_root) else {
            return vec![];
        };
        let mut bottles = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let conf_path = path.join(BOTTLE_CONF_FILENAME);
            if !conf_path.is_file() {
                continue; // not a bottle — no inventory marker
            }
            let Some(bottle_id) = path.file_name().and_then(|n| n.to_str()) else {
                continue; // non-UTF8 directory name — cannot form a stable id
            };
            let conf = std::fs::read_to_string(&conf_path)
                .ok()
                .map(|text| parse_bottle_conf(&text))
                .unwrap_or_default();
            bottles.push((bottle_id.to_string(), conf));
        }
        bottles
    }

    /// Discover apps for one bottle via its launcher-stub directory
    /// (`~/Applications/CrossOver/<Bottle>/*.app`) — the primary source of
    /// truth (design doc §Enumeration point 2). Returns `None` if the bottle
    /// has no stub directory at all (the caller falls back to `.cxmenu`
    /// links in that case); returns `Some` — even `Some(vec![])` — whenever
    /// the stub directory exists, since an existing-but-empty stub directory
    /// is CrossOver's own definitive "nothing stubbed here" answer, not a
    /// reason to also consult the fallback.
    fn scan_launcher_stubs(&self, bottle_id: &str) -> Option<Vec<DiscoveredGame>> {
        let stub_dir = self.launcher_stubs_root.join(bottle_id);
        let entries = std::fs::read_dir(&stub_dir).ok()?;
        let mut games = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("app") {
                continue;
            }
            let Some(app_name) = path.file_stem().and_then(|s| s.to_str()) else {
                continue; // non-UTF8 stub name — skip this entry, don't fail the scan
            };
            let stub_path = path.to_string_lossy().into_owned();
            games.push(DiscoveredGame {
                name: app_name.to_string(),
                source: GameSource::Crossover,
                external_id: Some(external_id(bottle_id, app_name)),
                launch_descriptor: serde_json::json!({
                    "kind": "app",
                    "bundle_path": stub_path,
                }),
                art_hint: Some(stub_path),
            });
        }
        Some(games)
    }

    /// Discover apps for one bottle via its `.cxmenu` desktop-link records —
    /// the fallback used only when the bottle has no launcher-stub directory
    /// (design doc §Enumeration point 2). A link record this parser can't
    /// classify (missing name or target) is skipped per-entry.
    fn scan_cxmenu_fallback(&self, bottle_id: &str) -> Vec<DiscoveredGame> {
        let desktop_dir = self
            .bottles_root
            .join(bottle_id)
            .join(BOTTLE_DESKTOP_SUBPATH);
        let Ok(entries) = std::fs::read_dir(&desktop_dir) else {
            return vec![];
        };
        let mut games = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("cxmenu") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue; // unreadable link record — skip
            };
            let link = parse_cxmenu_link(&text);
            let (Some(name), Some(target)) = (link.name, link.target) else {
                continue; // unclassifiable — design doc: skip, never fail the scan
            };
            games.push(DiscoveredGame {
                name: name.clone(),
                source: GameSource::Crossover,
                external_id: Some(external_id(bottle_id, &name)),
                launch_descriptor: serde_json::json!({
                    "kind": "crossover",
                    "bottle": bottle_id,
                    "target": target,
                }),
                // No macOS bundle to key bundle-icon art off in the fallback
                // path — a future rung could parse the .exe's own icon, but
                // that's out of scope here (design doc only promises the
                // stub path feeds the bundle-icon rung).
                art_hint: None,
            });
        }
        games
    }
}

/// Resolve the current user's home directory. Falls back to `/` only in the
/// unexpected case `$HOME` is unset, which simply makes the default scan
/// paths not exist (handled as the ordinary "no CrossOver installed" empty-
/// result case).
fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Build the stable `(source, external_id)` dedup key for one bottle+app pair
/// (design doc §Enumeration: `"<bottle>/<app-key>"`).
fn external_id(bottle_id: &str, app_key: &str) -> String {
    format!("{bottle_id}/{app_key}")
}

/// Parse a minimal subset of `cxbottle.conf`'s INI-style syntax: `[Section]`
/// headers and `Key = Value` lines within a `[Bottle]` section. Real
/// CrossOver installs were not available to validate these key names
/// against — this is a **fixture assumption** (design doc §Enumeration
/// caveat), encoded so the checked-in fixtures in this module's tests are the
/// single source of truth until a real-install follow-up confirms it.
fn parse_bottle_conf(text: &str) -> BottleConf {
    let mut conf = BottleConf::default();
    let mut in_bottle_section = false;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(['#', ';']) {
            continue;
        }
        if let Some(section) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            in_bottle_section = section.eq_ignore_ascii_case("Bottle");
            continue;
        }
        if !in_bottle_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"').to_string();
        match key {
            "Name" => conf.display_name = Some(value),
            "Template" => conf.template = Some(value),
            _ => {}
        }
    }
    conf
}

/// Parse a `.cxmenu` link record's simple `Key=Value` lines. Fixture
/// assumption (design doc caveat): `Name=` for the display name, `Target=`
/// (aliased `Exec=`) for the Windows-side launch path.
fn parse_cxmenu_link(text: &str) -> CxMenuLink {
    let mut fields: HashMap<String, String> = HashMap::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(['#', ';']) {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        fields.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
    }
    let name = fields.get("name").cloned().filter(|s| !s.is_empty());
    let target = fields
        .get("target")
        .or_else(|| fields.get("exec"))
        .cloned()
        .filter(|s| !s.is_empty());
    CxMenuLink { name, target }
}

impl GameSourceScanner for CrossoverScanner {
    fn scan(&self) -> AppResult<Vec<DiscoveredGame>> {
        if !self.is_crossover_present() {
            return Ok(vec![]);
        }
        let mut games = Vec::new();
        for (bottle_id, _conf) in self.list_bottles() {
            match self.scan_launcher_stubs(&bottle_id) {
                Some(stub_games) => games.extend(stub_games),
                None => games.extend(self.scan_cxmenu_fallback(&bottle_id)),
            }
        }
        Ok(games)
    }
}

/// Test-only fixture builders for `cxbottle.conf` / `.cxmenu` on-disk shapes.
/// Kept alongside the parser they exercise so an eventual real-install
/// validation pass (design doc follow-up) has one place to update both the
/// assumed shape and its fixtures together.
#[cfg(test)]
mod crossover_fixtures {
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Write a `Bottles/<name>/cxbottle.conf` fixture, returning the bottle
    /// directory path.
    pub fn write_bottle_conf(
        bottles_root: &Path,
        bottle_id: &str,
        display_name: &str,
        template: &str,
    ) -> PathBuf {
        let bottle_dir = bottles_root.join(bottle_id);
        fs::create_dir_all(&bottle_dir).unwrap();
        let contents = format!("[Bottle]\nName = \"{display_name}\"\nTemplate = \"{template}\"\n");
        fs::write(bottle_dir.join("cxbottle.conf"), contents).unwrap();
        bottle_dir
    }

    /// Write a launcher-stub `.app` bundle under
    /// `<stubs_root>/<bottle_id>/<app_name>.app`.
    pub fn write_launcher_stub(stubs_root: &Path, bottle_id: &str, app_name: &str) -> PathBuf {
        let stub = stubs_root.join(bottle_id).join(format!("{app_name}.app"));
        fs::create_dir_all(stub.join("Contents")).unwrap();
        stub
    }

    /// Write a `.cxmenu` link-record fixture under a bottle's
    /// `drive_c/users/crossover/Desktop`.
    pub fn write_cxmenu_link(
        bottles_root: &Path,
        bottle_id: &str,
        file_stem: &str,
        name: &str,
        target: &str,
    ) {
        let desktop = bottles_root
            .join(bottle_id)
            .join("drive_c/users/crossover/Desktop");
        fs::create_dir_all(&desktop).unwrap();
        let contents = format!("Name={name}\nTarget={target}\n");
        fs::write(desktop.join(format!("{file_stem}.cxmenu")), contents).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::crossover_fixtures::*;
    use super::*;
    use std::path::Path;

    fn scanner_with_roots(tmp: &Path) -> (PathBuf, PathBuf, CrossoverScanner) {
        let bottles_root = tmp.join("Bottles");
        let stubs_root = tmp.join("LauncherStubs");
        std::fs::create_dir_all(&bottles_root).unwrap();
        std::fs::create_dir_all(&stubs_root).unwrap();
        let scanner = CrossoverScanner::new(vec![], &bottles_root, &stubs_root);
        (bottles_root, stubs_root, scanner)
    }

    // --- Detection ---

    #[test]
    fn no_app_bundle_and_no_bottle_root_is_empty_not_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let missing_bottles = tmp.path().join("does-not-exist-bottles");
        let missing_stubs = tmp.path().join("does-not-exist-stubs");
        let scanner = CrossoverScanner::new(
            vec![tmp.path().join("does-not-exist.app")],
            missing_bottles,
            missing_stubs,
        );

        let games = scanner.scan().unwrap();

        assert!(games.is_empty());
    }

    #[test]
    fn an_existing_app_bundle_alone_counts_as_present_but_yields_no_bottles() {
        let tmp = tempfile::tempdir().unwrap();
        let app_bundle = tmp.path().join("CrossOver.app");
        std::fs::create_dir_all(app_bundle.join("Contents")).unwrap();
        let missing_bottles = tmp.path().join("does-not-exist-bottles");
        let missing_stubs = tmp.path().join("does-not-exist-stubs");
        let scanner = CrossoverScanner::new(vec![app_bundle], missing_bottles, missing_stubs);

        let games = scanner.scan().unwrap();

        assert!(
            games.is_empty(),
            "present but no bottles yet ⇒ zero games, not an error"
        );
    }

    #[test]
    fn an_existing_bottle_root_alone_counts_as_present() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, _scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Steam", "Steam", "win10");
        write_launcher_stub(&stubs_root, "Steam", "Half-Life 2");
        let scanner =
            CrossoverScanner::new(vec![tmp.path().join("no.app")], &bottles_root, &stubs_root);

        let games = scanner.scan().unwrap();

        assert_eq!(
            games.len(),
            1,
            "bottle root alone (no .app candidate) must still enable enumeration"
        );
    }

    // --- Bottle inventory (cxbottle.conf) ---

    #[test]
    fn a_directory_without_cxbottle_conf_is_not_a_bottle() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, scanner) = scanner_with_roots(tmp.path());
        std::fs::create_dir_all(bottles_root.join("NotABottle")).unwrap();
        write_launcher_stub(&stubs_root, "NotABottle", "SomeApp");

        let games = scanner.scan().unwrap();

        assert!(
            games.is_empty(),
            "a bottle-shaped dir without cxbottle.conf must be ignored"
        );
    }

    #[test]
    fn a_bottle_with_no_apps_yields_zero_games_for_that_bottle() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, _stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Empty Bottle", "Empty Bottle", "win10");

        let games = scanner.scan().unwrap();

        assert!(games.is_empty());
    }

    #[test]
    fn an_unparseable_cxbottle_conf_still_enumerates_the_bottle_by_directory_name() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, scanner) = scanner_with_roots(tmp.path());
        let bottle_dir = bottles_root.join("Weird Bottle");
        std::fs::create_dir_all(&bottle_dir).unwrap();
        std::fs::write(
            bottle_dir.join("cxbottle.conf"),
            "not even close to ini\x00\x01",
        )
        .unwrap();
        write_launcher_stub(&stubs_root, "Weird Bottle", "Some Game");

        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(
            games[0].external_id.as_deref(),
            Some("Weird Bottle/Some Game")
        );
    }

    // --- Launcher-stub enumeration (primary) ---

    #[test]
    fn discovers_an_app_from_its_launcher_stub() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Steam", "Steam", "win10");
        let stub = write_launcher_stub(&stubs_root, "Steam", "Half-Life 2");

        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Half-Life 2");
        assert_eq!(games[0].source, GameSource::Crossover);
        assert_eq!(games[0].external_id.as_deref(), Some("Steam/Half-Life 2"));
        assert_eq!(games[0].launch_descriptor["kind"], "app");
        assert_eq!(
            games[0].launch_descriptor["bundle_path"],
            stub.to_string_lossy().to_string()
        );
        assert_eq!(
            games[0].art_hint.as_deref(),
            Some(stub.to_string_lossy().as_ref())
        );
    }

    #[test]
    fn discovers_multiple_apps_across_multiple_bottles() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Steam", "Steam", "win10");
        write_bottle_conf(&bottles_root, "Origin", "Origin", "win10");
        write_launcher_stub(&stubs_root, "Steam", "Half-Life 2");
        write_launcher_stub(&stubs_root, "Steam", "Portal");
        write_launcher_stub(&stubs_root, "Origin", "Titanfall 2");

        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 3);
        let ids: Vec<&str> = games
            .iter()
            .filter_map(|g| g.external_id.as_deref())
            .collect();
        assert!(ids.contains(&"Steam/Half-Life 2"));
        assert!(ids.contains(&"Steam/Portal"));
        assert!(ids.contains(&"Origin/Titanfall 2"));
    }

    #[test]
    fn non_app_entries_in_the_stub_directory_are_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Steam", "Steam", "win10");
        write_launcher_stub(&stubs_root, "Steam", "Half-Life 2");
        std::fs::write(stubs_root.join("Steam").join("readme.txt"), "not an app").unwrap();

        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
    }

    // --- .cxmenu fallback (no launcher-stub directory) ---

    #[test]
    fn falls_back_to_cxmenu_links_when_no_stub_directory_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, _stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Legacy", "Legacy", "win7");
        write_cxmenu_link(
            &bottles_root,
            "Legacy",
            "oldgame",
            "Old Game",
            r"C:\Program Files\Old Game\oldgame.exe",
        );
        // No launcher-stub directory created at all for "Legacy".

        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Old Game");
        assert_eq!(games[0].source, GameSource::Crossover);
        assert_eq!(games[0].external_id.as_deref(), Some("Legacy/Old Game"));
        assert_eq!(games[0].launch_descriptor["kind"], "crossover");
        assert_eq!(games[0].launch_descriptor["bottle"], "Legacy");
        assert_eq!(
            games[0].launch_descriptor["target"],
            r"C:\Program Files\Old Game\oldgame.exe"
        );
        assert!(games[0].art_hint.is_none());
    }

    #[test]
    fn stub_directory_present_but_empty_still_prevents_the_cxmenu_fallback() {
        // Design intent: stubs are primary. An empty (but existing) stub dir
        // for a bottle means "CrossOver looked and found nothing to stub" —
        // this scanner does not additionally consult .cxmenu links in that
        // case, only when the stub directory doesn't exist at all.
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Steam", "Steam", "win10");
        std::fs::create_dir_all(stubs_root.join("Steam")).unwrap();
        write_cxmenu_link(
            &bottles_root,
            "Steam",
            "hl2",
            "Half-Life 2",
            r"C:\Program Files\Steam\hl2.exe",
        );

        let games = scanner.scan().unwrap();

        assert!(games.is_empty());
    }

    #[test]
    fn a_cxmenu_link_missing_a_name_or_target_is_skipped_per_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, _stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Legacy", "Legacy", "win7");
        write_cxmenu_link(
            &bottles_root,
            "Legacy",
            "good",
            "Good Game",
            r"C:\Good\good.exe",
        );
        // Missing target — write directly to control the malformed shape.
        let desktop = bottles_root.join("Legacy/drive_c/users/crossover/Desktop");
        std::fs::create_dir_all(&desktop).unwrap();
        std::fs::write(desktop.join("bad.cxmenu"), "Name=Bad Game\n").unwrap();

        let games = scanner.scan().unwrap();

        assert_eq!(
            games.len(),
            1,
            "the malformed link must be skipped, not fail the scan"
        );
        assert_eq!(games[0].name, "Good Game");
    }

    #[test]
    fn non_cxmenu_files_on_the_desktop_are_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, _stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Legacy", "Legacy", "win7");
        write_cxmenu_link(
            &bottles_root,
            "Legacy",
            "good",
            "Good Game",
            r"C:\Good\good.exe",
        );
        let desktop = bottles_root.join("Legacy/drive_c/users/crossover/Desktop");
        std::fs::write(desktop.join("notes.txt"), "not a link record").unwrap();

        let games = scanner.scan().unwrap();

        assert_eq!(games.len(), 1);
    }

    // --- Dedup / rescan stability ---

    #[test]
    fn rescan_of_same_fixtures_discovers_the_same_games_each_time() {
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Steam", "Steam", "win10");
        write_launcher_stub(&stubs_root, "Steam", "Half-Life 2");

        let first = scanner.scan().unwrap();
        let second = scanner.scan().unwrap();

        assert_eq!(first, second);
    }

    // --- No structural overlap with Steam/app/GOG/itch scanners ---

    #[test]
    fn launcher_stub_paths_never_sit_under_a_steam_owned_tree() {
        // Structural guarantee (design doc §Enumeration): launcher stubs live
        // only under ~/Applications/CrossOver/, so they cannot collide with
        // the Steam scanner's `.../Steam/steamapps/` claim tree, or the
        // app-scanner's plain /Applications root (a *different* directory
        // than /Applications/CrossOver/<Bottle>/, one level deeper and
        // namespaced by bottle).
        let tmp = tempfile::tempdir().unwrap();
        let (bottles_root, stubs_root, scanner) = scanner_with_roots(tmp.path());
        write_bottle_conf(&bottles_root, "Steam", "Steam", "win10");
        let stub = write_launcher_stub(&stubs_root, "Steam", "Half-Life 2");

        let games = scanner.scan().unwrap();

        let bundle_path = games[0].launch_descriptor["bundle_path"].as_str().unwrap();
        assert_eq!(bundle_path, stub.to_string_lossy());
        assert!(!bundle_path.to_lowercase().contains("/steam/steamapps/"));
    }

    // --- cxbottle.conf / .cxmenu parsers (unit-level, no filesystem) ---

    #[test]
    fn parse_bottle_conf_reads_the_assumed_field_names() {
        let text = "[Bottle]\nName = \"My Bottle\"\nTemplate = \"win10\"\n";
        let conf = parse_bottle_conf(text);
        assert_eq!(conf.display_name.as_deref(), Some("My Bottle"));
        assert_eq!(conf.template.as_deref(), Some("win10"));
    }

    #[test]
    fn parse_bottle_conf_ignores_fields_outside_the_bottle_section() {
        let text = "[Other]\nName = \"Not This One\"\n[Bottle]\nName = \"Correct\"\n";
        let conf = parse_bottle_conf(text);
        assert_eq!(conf.display_name.as_deref(), Some("Correct"));
    }

    #[test]
    fn parse_bottle_conf_on_empty_text_yields_default() {
        assert_eq!(parse_bottle_conf(""), BottleConf::default());
    }

    #[test]
    fn parse_cxmenu_link_accepts_the_exec_alias_for_target() {
        let text = "Name=Aliased Game\nExec=C:\\Games\\aliased.exe\n";
        let link = parse_cxmenu_link(text);
        assert_eq!(link.name.as_deref(), Some("Aliased Game"));
        assert_eq!(link.target.as_deref(), Some(r"C:\Games\aliased.exe"));
    }

    #[test]
    fn parse_cxmenu_link_on_empty_text_yields_default() {
        assert_eq!(parse_cxmenu_link(""), CxMenuLink::default());
    }
}
