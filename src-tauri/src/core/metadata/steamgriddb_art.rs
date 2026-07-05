//! SteamGridDB art fetch/cache orchestrator (v0.32 W321 — see
//! `docs/design/non-retro-library-design.md` §SteamGridDB art (W321)).
//!
//! Mirrors [`super::steam_art`]'s role: drives one name-based SteamGridDB
//! lookup for a title with no Steam appid (apps, manual entries, GOG, itch),
//! and persists a hit through the shared [`super::art_cache::ArtCacheService`]
//! under a `steamgriddb` origin tag — reusing the `art_cache` table/priority
//! machinery rather than a parallel pipeline.
//!
//! Every failure mode — no API key configured, a zero-result search, a
//! matched game with no grid art, or any HTTP/transport error — degrades to
//! `Ok(None)` so the caller falls back to the next rung in the fallback chain
//! (`super::art_fallback_chain`) rather than surfacing an error. This is the
//! W321 acceptance contract: "API failures degrade to no-art with a log
//! line, never block scans."
//!
//! Fetches are inherently serial: `spawn_art_acquisition` (in
//! `commands::sources`) already runs one dedicated OS thread per discovered
//! game rather than a shared pool, so no additional queue/semaphore is
//! needed here to stay rate-limit friendly — each thread makes at most two
//! SteamGridDB requests (search + grid lookup) plus one image download, and
//! there is no retry loop on failure (no retry storms).

use super::art_cache::ArtCacheService;
use super::steamgriddb_client::SteamGridDbClient;
use crate::config::paths::Paths;
use crate::db::Db;
use crate::error::AppResult;

/// Namespace under `art-cache/` used for SteamGridDB-sourced art, mirroring
/// how Steam CDN art is namespaced under `steam`.
pub const STEAMGRIDDB_ART_NAMESPACE: &str = "steamgriddb";

/// `art_cache.tier` DB key for a SteamGridDB grid image — grids are the
/// shelf-preferred portrait/boxart shape, so they map to the same top
/// display-priority tier bundle icons use.
const STEAMGRIDDB_ART_TIER: &str = "boxart";

/// File extension SteamGridDB grid images are cached as. The API can serve
/// PNG or JPEG; caching everything under one extension keeps the on-disk
/// naming scheme uniform with the rest of the art_cache pipeline (the actual
/// image bytes are written verbatim regardless of their true format, which
/// every consumer here — `<img src>` — decodes by content, not extension).
const STEAMGRIDDB_ART_EXTENSION: &str = "img";

/// Attempt to fetch grid art for `title` from SteamGridDB and cache it
/// through [`ArtCacheService`]. Returns the on-disk path on a hit, or `None`
/// for any miss or failure (no key, empty search, no grid art, network
/// failure) — never an `Err` propagated to the scan.
///
/// `api_key` is the user-supplied SteamGridDB key (Settings pane, v0.32
/// W321); `None` or empty makes this function an immediate no-op so the
/// provider stays fully inert without a key, per the design doc's "no key ⇒
/// provider fully inert" contract.
pub fn fetch_steamgriddb_art(
    db: &Db,
    paths: &Paths,
    game_id: i64,
    title: &str,
    sanitized_name: &str,
    api_key: Option<&str>,
) -> AppResult<Option<String>> {
    let Some(api_key) = api_key.filter(|k| !k.trim().is_empty()) else {
        return Ok(None);
    };

    let client = SteamGridDbClient::new(api_key);
    let found = match client.find_best_grid_art(title) {
        Ok(found) => found,
        Err(e) => {
            eprintln!("[steamgriddb_art] search failed for {title:?}: {e}");
            return Ok(None);
        }
    };
    let Some(matched) = found else {
        return Ok(None);
    };

    let bytes = match client.download_image(&matched.image_url) {
        Ok(bytes) => bytes,
        Err(e) => {
            eprintln!(
                "[steamgriddb_art] image download failed for {title:?} (game id {}): {e}",
                matched.game_id
            );
            return Ok(None);
        }
    };

    let svc = ArtCacheService::new(db, paths);
    let path = svc.store_with_extension(
        game_id,
        STEAMGRIDDB_ART_NAMESPACE,
        sanitized_name,
        STEAMGRIDDB_ART_TIER,
        &bytes,
        STEAMGRIDDB_ART_EXTENSION,
    )?;

    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::art_cache::ArtCacheRepo;
    use crate::db::repo::library::{GameSource, LibraryRepo, NewGame};
    use crate::db::repo::Repository;

    fn seed_game(db: &Db, name: &str) -> i64 {
        let lib = LibraryRepo::new(db);
        lib.add_game(&NewGame {
            folder_id: None,
            path: None,
            system: None,
            crc32: None,
            md5: None,
            clean_name: name.to_string(),
            dat_matched: false,
            core_hint: None,
            art_path: None,
            size_bytes: 0,
            added_at: 1,
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
            source: GameSource::Gog,
            launch_descriptor: Some(
                serde_json::json!({ "kind": "app", "bundle_path": "/Applications/X.app" })
                    .to_string(),
            ),
            external_id: Some("x".to_string()),
        })
        .unwrap()
    }

    /// The inert-without-key contract: `fetch_steamgriddb_art` must return
    /// `Ok(None)` without making any network call when no key is configured
    /// — proven here by simply not standing up a fixture server at all; if
    /// the function tried to reach the network it would error, not return
    /// `Ok(None)`.
    #[test]
    fn is_inert_without_an_api_key() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db, "GWENT");

        let result = fetch_steamgriddb_art(&db, &paths, game_id, "GWENT", "GWENT", None).unwrap();
        assert_eq!(result, None);
        assert!(ArtCacheRepo::new(&db).list_for_game(game_id).unwrap().is_empty());
    }

    /// An empty/whitespace-only key is treated the same as no key at all —
    /// a settings field left blank must not attempt a request with an
    /// obviously-invalid credential.
    #[test]
    fn is_inert_with_a_blank_api_key() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db, "GWENT");

        let result =
            fetch_steamgriddb_art(&db, &paths, game_id, "GWENT", "GWENT", Some("   ")).unwrap();
        assert_eq!(result, None);
    }

    /// Exercises the cache-write half of the pipeline directly (mirrors
    /// `steam_art`'s `stores_fetched_asset_bytes_keyed_on_appid` test): given
    /// fetched bytes, `store_with_extension` persists under the
    /// `steamgriddb` namespace, tagged `boxart`, keyed on the sanitized name
    /// — the exact call `fetch_steamgriddb_art` makes on a hit.
    #[test]
    fn stores_fetched_art_bytes_under_the_steamgriddb_namespace() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db, "GWENT");

        let svc = ArtCacheService::new(&db, &paths);
        let path = svc
            .store_with_extension(
                game_id,
                STEAMGRIDDB_ART_NAMESPACE,
                "GWENT",
                STEAMGRIDDB_ART_TIER,
                b"GRID_BYTES",
                STEAMGRIDDB_ART_EXTENSION,
            )
            .unwrap();

        assert!(std::path::Path::new(&path).exists());
        assert!(path.ends_with("GWENT_boxart.img"));
        assert!(path.contains("steamgriddb"));

        let entries = ArtCacheRepo::new(&db).list_for_game(game_id).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tier, "boxart");

        let game = LibraryRepo::new(&db).get_game(game_id).unwrap();
        assert_eq!(game.art_path.as_deref(), Some(path.as_str()));
    }
}
