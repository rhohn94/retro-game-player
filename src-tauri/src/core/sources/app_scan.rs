//! AppScanner (v0.31 W313): enumerates `/Applications` and `~/Applications`
//! `.app` bundles and shortlists the ones that look like games, via each
//! bundle's `Info.plist` `LSApplicationCategoryType`
//! (`public.app-category.games*`). See
//! `docs/design/non-retro-library-design.md` §Game sources.
//!
//! This scanner only *proposes* a shortlist — [`GameSourceScanner::scan`]
//! never creates a library row itself; the IPC layer confirm-gates before
//! calling `LibraryRepo::upsert_game_by_source` (no silent library flooding).

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{DiscoveredGame, GameSourceScanner};
use crate::db::repo::library::GameSource;
use crate::error::AppResult;

/// The `Info.plist` fields we care about; every other key is ignored by
/// `plist`'s serde support.
#[derive(Debug, Deserialize)]
struct InfoPlist {
    #[serde(rename = "CFBundleName")]
    bundle_name: Option<String>,
    #[serde(rename = "CFBundleDisplayName")]
    bundle_display_name: Option<String>,
    #[serde(rename = "CFBundleIdentifier")]
    bundle_identifier: Option<String>,
    #[serde(rename = "LSApplicationCategoryType")]
    category: Option<String>,
}

/// Enumerates `.app` bundles under `/Applications` and `~/Applications` and
/// shortlists games by `LSApplicationCategoryType`.
pub struct AppScanner {
    /// Directories to scan (defaults to the two standard Applications
    /// locations; overridable for tests).
    roots: Vec<PathBuf>,
}

impl AppScanner {
    /// The real scanner: `/Applications` + `~/Applications` (whichever exist).
    pub fn new() -> Self {
        let mut roots = vec![PathBuf::from("/Applications")];
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Applications"));
        }
        Self { roots }
    }

    /// A scanner over caller-supplied roots (unit tests use a temp dir tree
    /// instead of touching the real `/Applications`).
    pub fn with_roots(roots: Vec<PathBuf>) -> Self {
        Self { roots }
    }

    /// Whether `category` (an `LSApplicationCategoryType` UTI) marks the
    /// bundle as a game, per Apple's `public.app-category.games*` family
    /// (e.g. `public.app-category.action-games`, `.board-games`, or the bare
    /// `public.app-category.games`).
    fn is_game_category(category: &str) -> bool {
        category == "public.app-category.games" || category.starts_with("public.app-category.") && category.contains("-games")
    }

    /// Whether `bundle_path` sits under a Steam-owned install tree
    /// (`.../Steam/steamapps/...`), so the app scan excludes titles the
    /// Steam source already owns (design doc: "Excludes bundles already
    /// owned by the Steam source").
    fn is_steam_owned(bundle_path: &Path) -> bool {
        let lower = bundle_path.to_string_lossy().to_lowercase();
        lower.contains("/steam/steamapps/")
    }

    /// Parse one `.app` bundle's `Contents/Info.plist` and, if it is a games-
    /// category app not owned by Steam, produce a `DiscoveredGame`.
    fn discover_one(bundle_path: &Path) -> Option<DiscoveredGame> {
        if Self::is_steam_owned(bundle_path) {
            return None;
        }
        let plist_path = bundle_path.join("Contents/Info.plist");
        let info: InfoPlist = plist::from_file(&plist_path).ok()?;
        let category = info.category.as_deref()?;
        if !Self::is_game_category(category) {
            return None;
        }
        let name = info
            .bundle_display_name
            .or(info.bundle_name)
            .unwrap_or_else(|| {
                bundle_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "Unknown".to_string())
            });
        let bundle_path_str = bundle_path.to_string_lossy().into_owned();
        Some(DiscoveredGame {
            name,
            source: GameSource::App,
            external_id: info.bundle_identifier.or_else(|| Some(bundle_path_str.clone())),
            launch_descriptor: serde_json::json!({
                "kind": "app",
                "bundle_path": bundle_path_str,
            }),
            art_hint: Some(bundle_path.to_string_lossy().into_owned()),
        })
    }
}

impl Default for AppScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl GameSourceScanner for AppScanner {
    /// Enumerate top-level `.app` bundles under each configured root and
    /// shortlist the games-category ones. A missing root is not an error
    /// (mirrors the Steam scanner's "absent inventory -> empty result"
    /// contract) — it simply contributes zero entries.
    fn scan(&self) -> AppResult<Vec<DiscoveredGame>> {
        let mut found = Vec::new();
        for root in &self.roots {
            let Ok(entries) = std::fs::read_dir(root) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("app") {
                    continue;
                }
                if let Some(game) = Self::discover_one(&path) {
                    found.push(game);
                }
            }
        }
        Ok(found)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_bundle(root: &Path, app_name: &str, plist_body: &str) -> PathBuf {
        let bundle = root.join(app_name);
        let contents = bundle.join("Contents");
        fs::create_dir_all(&contents).unwrap();
        fs::write(contents.join("Info.plist"), plist_body).unwrap();
        bundle
    }

    fn plist_xml(display_name: &str, bundle_id: &str, category: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>{display_name}</string>
    <key>CFBundleIdentifier</key>
    <string>{bundle_id}</string>
    <key>LSApplicationCategoryType</key>
    <string>{category}</string>
</dict>
</plist>"#
        )
    }

    fn temp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "rgp-appscan-{tag}-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&p).ok();
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn shortlists_a_games_category_bundle() {
        let root = temp_root("games");
        write_bundle(
            &root,
            "Cool Game.app",
            &plist_xml("Cool Game", "com.example.coolgame", "public.app-category.action-games"),
        );

        let found = AppScanner::with_roots(vec![root.clone()]).scan().unwrap();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Cool Game");
        assert_eq!(found[0].source, GameSource::App);
        assert_eq!(found[0].external_id.as_deref(), Some("com.example.coolgame"));
        assert_eq!(found[0].launch_descriptor["kind"], "app");
        assert!(found[0].launch_descriptor["bundle_path"]
            .as_str()
            .unwrap()
            .ends_with("Cool Game.app"));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn excludes_non_game_category_bundles() {
        let root = temp_root("nongame");
        write_bundle(
            &root,
            "Text Editor.app",
            &plist_xml("Text Editor", "com.example.editor", "public.app-category.productivity"),
        );

        let found = AppScanner::with_roots(vec![root.clone()]).scan().unwrap();

        assert!(found.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn excludes_steam_owned_bundles() {
        let root = temp_root("steam");
        let steam_apps = root.join("Steam/steamapps/common/SomeGame");
        std::fs::create_dir_all(&steam_apps).unwrap();
        write_bundle(
            &steam_apps,
            "SomeGame.app",
            &plist_xml("SomeGame", "com.valve.somegame", "public.app-category.action-games"),
        );

        // Scan the bundle's *parent* dir directly (mirrors how the real
        // scanner walks a single root looking for `.app` children).
        let found = AppScanner::with_roots(vec![steam_apps]).scan().unwrap();

        assert!(found.is_empty(), "Steam-owned bundles must be excluded");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_root_yields_empty_not_error() {
        let missing = std::env::temp_dir().join("rgp-appscan-does-not-exist-xyz");
        std::fs::remove_dir_all(&missing).ok();

        let found = AppScanner::with_roots(vec![missing]).scan().unwrap();

        assert!(found.is_empty());
    }

    #[test]
    fn falls_back_to_bundle_name_when_no_display_name() {
        let root = temp_root("noname");
        let bundle = root.join("Falls Back.app");
        let contents = bundle.join("Contents");
        fs::create_dir_all(&contents).unwrap();
        fs::write(
            contents.join("Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>FallsBack</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.games</string>
</dict>
</plist>"#,
        )
        .unwrap();

        let found = AppScanner::with_roots(vec![root.clone()]).scan().unwrap();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "FallsBack");
        // No CFBundleIdentifier -> external_id falls back to the bundle path.
        assert!(found[0].external_id.as_deref().unwrap().ends_with("Falls Back.app"));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn is_game_category_matches_the_games_family() {
        assert!(AppScanner::is_game_category("public.app-category.games"));
        assert!(AppScanner::is_game_category("public.app-category.action-games"));
        assert!(AppScanner::is_game_category("public.app-category.board-games"));
        assert!(!AppScanner::is_game_category("public.app-category.productivity"));
        assert!(!AppScanner::is_game_category("public.app-category.utilities"));
    }
}
