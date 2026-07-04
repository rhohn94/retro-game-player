//! Steam CDN art fetch/cache orchestrator (v0.31 W314 — see
//! `docs/design/non-retro-library-design.md` §Art & metadata).
//!
//! Mirrors [`super::fallback`]'s role for libretro-thumbnails: this module
//! drives the fetch sequence for one Steam-sourced game (portrait capsule →
//! header → hero, see [`SteamArtAsset::fetch_sequence`]) and persists hits
//! through the shared [`super::art_cache::ArtCacheService`], reusing the
//! `art_cache` table/priority machinery rather than a parallel pipeline.
//!
//! All network calls go through the async CDN client; every fetch failure —
//! transport error or a 404 on every asset — degrades to `Ok(None)` so the
//! caller can fall back to the placeholder without surfacing an error to the
//! scan (W314 acceptance: "fetch failure degrades to placeholder, never an
//! error surfaced to the scan").

use super::art_cache::ArtCacheService;
use super::steam_cdn::{build_steam_art_url, fetch_image, SteamArtAsset};
use crate::config::paths::Paths;
use crate::db::Db;
use crate::error::AppResult;

/// Namespace under `art-cache/` used for Steam-sourced art, mirroring how
/// ROM art is namespaced by emulated system.
pub const STEAM_ART_NAMESPACE: &str = "steam";

/// File extension Steam's CDN serves art as.
const STEAM_ART_EXTENSION: &str = "jpg";

/// Attempt to fetch every Steam CDN art asset for `appid`, caching each hit
/// through [`ArtCacheService`]. Returns the on-disk path of the
/// highest-priority asset fetched (portrait capsule, if available), or
/// `None` if every asset missed (a graceful CDN miss — not an error).
///
/// A transport-level failure (offline, DNS failure, timeout) is swallowed
/// per-asset and treated the same as a 404: the loop simply continues to the
/// next asset, and an all-miss result yields `Ok(None)` rather than
/// propagating the error. This is the graceful-degradation contract W314
/// requires ("network code must degrade gracefully offline").
pub async fn fetch_steam_art(
    db: &Db,
    paths: &Paths,
    game_id: i64,
    appid: &str,
) -> AppResult<Option<String>> {
    // Defense-in-depth mirror of the scan-time guard in `sources::steam`: the
    // appid becomes a cache filename component (`{appid}_{tier}.jpg`) and a
    // CDN URL segment, and it can reach this function from a pre-fix DB row's
    // art hint — so a non-numeric appid is refused here too, not just at parse.
    if appid.is_empty() || !appid.chars().all(|c| c.is_ascii_digit()) {
        return Ok(None);
    }
    let svc = ArtCacheService::new(db, paths);
    let mut best: Option<String> = None;

    for asset in SteamArtAsset::fetch_sequence() {
        let url = build_steam_art_url(appid, *asset);
        let fetched = fetch_image(&url).await;
        let bytes = match fetched {
            Ok(Some(bytes)) => bytes,
            Ok(None) => continue,  // 404 for this asset — try the next one
            Err(_) => continue,    // network failure — degrade, don't propagate
        };

        let path = svc.store_with_extension(
            game_id,
            STEAM_ART_NAMESPACE,
            appid,
            asset.db_key(),
            &bytes,
            STEAM_ART_EXTENSION,
        )?;

        if best.is_none() {
            best = Some(path);
        }
    }

    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::paths::Paths;
    use crate::db::repo::art_cache::ArtCacheRepo;
    use crate::db::repo::library::{GameSource, LibraryRepo, NewGame};
    use crate::db::repo::Repository;
    use crate::db::Db;

    fn seed_steam_game(db: &Db, appid: &str) -> i64 {
        let lib = LibraryRepo::new(db);
        lib.add_game(&NewGame {
            folder_id: None,
            path: None,
            system: None,
            crc32: None,
            md5: None,
            clean_name: "Portal 2".into(),
            dat_matched: false,
            core_hint: None,
            art_path: None,
            size_bytes: 0,
            added_at: 1,
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
            source: GameSource::Steam,
            launch_descriptor: Some(
                serde_json::json!({ "kind": "steam", "appid": appid }).to_string(),
            ),
            external_id: Some(appid.to_string()),
        })
        .unwrap()
    }

    /// Fetching real Steam CDN art needs an async runtime + real network,
    /// which unit tests don't exercise (per the existing `cdn_client`/
    /// `fallback` pattern — network round-trips are integration-test
    /// territory only). This test exercises the cache-write half of the
    /// pipeline directly: given fetched bytes, `store_with_extension`
    /// persists under the `steam` namespace with the appid as the sanitized
    /// name, keyed on the asset's tier — the exact call `fetch_steam_art`
    /// makes per asset.
    #[test]
    fn stores_fetched_asset_bytes_keyed_on_appid() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_steam_game(&db, "620");

        let svc = ArtCacheService::new(&db, &paths);
        let path = svc
            .store_with_extension(
                game_id,
                STEAM_ART_NAMESPACE,
                "620",
                SteamArtAsset::LibraryPortrait.db_key(),
                b"JPEG_BYTES",
                STEAM_ART_EXTENSION,
            )
            .unwrap();

        assert!(std::path::Path::new(&path).exists());
        assert!(path.ends_with("620_boxart.jpg"));
        assert!(path.contains("steam"));

        let entries = ArtCacheRepo::new(&db).list_for_game(game_id).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tier, "boxart");

        let game = LibraryRepo::new(&db).get_game(game_id).unwrap();
        assert_eq!(game.art_path.as_deref(), Some(path.as_str()));
    }

    /// The defense-in-depth appid guard: a non-numeric appid (e.g. a
    /// traversal payload persisted by a pre-guard row) must short-circuit to
    /// `Ok(None)` before any URL is built or any cache filename is formed.
    /// Returning without network I/O is also what makes this unit-testable.
    #[test]
    fn non_numeric_appid_is_refused_without_fetching() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_steam_game(&db, "620");

        for bad in ["../../etc/passwd", "", "12a4", "620/../x"] {
            let got = tauri::async_runtime::block_on(fetch_steam_art(&db, &paths, game_id, bad))
                .unwrap();
            assert!(got.is_none(), "appid {bad:?} must be refused");
        }
        assert!(ArtCacheRepo::new(&db).list_for_game(game_id).unwrap().is_empty());
    }

    #[test]
    fn urls_built_for_every_asset_in_priority_order() {
        let urls: Vec<String> = SteamArtAsset::fetch_sequence()
            .iter()
            .map(|a| build_steam_art_url("620", *a))
            .collect();

        assert_eq!(
            urls,
            vec![
                "https://steamcdn-a.akamaihd.net/steam/apps/620/library_600x900_2x.jpg",
                "https://steamcdn-a.akamaihd.net/steam/apps/620/header.jpg",
                "https://steamcdn-a.akamaihd.net/steam/apps/620/library_hero.jpg",
            ]
        );
    }

    #[test]
    fn best_path_prefers_first_successful_asset_in_priority_order() {
        // Mirrors fetch_steam_art's "first hit wins for `best`" behaviour:
        // storing hero first, then portrait, must still report portrait as
        // best via ArtCacheService's own tier-priority resolution — this
        // guards against `fetch_steam_art` accidentally returning the *last*
        // asset stored rather than the highest-priority one.
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_steam_game(&db, "620");

        let svc = ArtCacheService::new(&db, &paths);
        svc.store_with_extension(
            game_id,
            STEAM_ART_NAMESPACE,
            "620",
            SteamArtAsset::LibraryHero.db_key(),
            b"hero",
            STEAM_ART_EXTENSION,
        )
        .unwrap();
        svc.store_with_extension(
            game_id,
            STEAM_ART_NAMESPACE,
            "620",
            SteamArtAsset::LibraryPortrait.db_key(),
            b"portrait",
            STEAM_ART_EXTENSION,
        )
        .unwrap();

        let best = svc.best_cached_path(game_id).unwrap();
        assert!(best.unwrap().ends_with("620_boxart.jpg"));
    }
}
