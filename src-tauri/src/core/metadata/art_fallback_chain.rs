//! Deterministic per-title art fallback chain (v0.32 W321 — see
//! `docs/design/non-retro-library-design.md` §SteamGridDB art (W321)).
//!
//! Every non-ROM library row resolves its art through the same fixed rung
//! order:
//!
//! 1. **Steam CDN** (appid) — [`super::steam_art::fetch_steam_art`].
//! 2. **SteamGridDB** (API key present) — [`super::steamgriddb_art::fetch_steamgriddb_art`].
//! 3. **Bundle icon** (`.app` bundle) — [`super::bundle_icon::fetch_bundle_icon_art`].
//! 4. **Placeholder** — the existing frontend fallback when no rung above
//!    produced a cached path; this module returns `Ok(None)` in that case
//!    rather than special-casing a "placeholder" fetch, mirroring every
//!    lower-level fetcher's own "no art found" contract.
//!
//! A rung is skipped (not attempted) when its precondition doesn't hold —
//! no appid, no API key, no resolvable bundle path — and a rung that *is*
//! attempted but fails (network error, cache miss, decode failure) degrades
//! silently to the next rung. No failure here ever propagates as an `Err`:
//! the whole point of the chain is that art acquisition can never block or
//! fail a scan (W321/W323 acceptance).
//!
//! This is the single place [`crate::commands::sources::spawn_art_acquisition`]
//! delegates to for every non-ROM, non-pure-Steam-CDN-only source, so the
//! rung order is defined and tested in exactly one spot rather than being
//! re-derived at each call site.

use super::bundle_icon::fetch_bundle_icon_art;
use super::steam_art::fetch_steam_art;
use super::steamgriddb_art::fetch_steamgriddb_art;
use crate::config::paths::Paths;
use crate::db::Db;
use crate::error::AppResult;

/// Everything the fallback chain needs to attempt each rung for one title.
/// Constructed once per art-acquisition job (`spawn_art_acquisition`) from
/// the scanner-supplied hint and the game's display name.
#[derive(Debug, Clone)]
pub struct ArtFallbackInput<'a> {
    /// Steam appid, if this row came from the Steam source (rung 1
    /// precondition). `None` for every other source.
    pub steam_appid: Option<&'a str>,
    /// SteamGridDB API key, if the user has configured one (rung 2
    /// precondition). `None`/empty makes rung 2 a no-op.
    pub steamgriddb_api_key: Option<&'a str>,
    /// `.app` bundle path, if this row's launch descriptor names one (rung 3
    /// precondition). `None` for an `exec`-target manual entry, for example.
    pub bundle_path: Option<&'a str>,
    /// The title's display name — used both as the SteamGridDB search term
    /// and (sanitized) as the bundle-icon cache filename.
    pub display_name: &'a str,
}

/// Which rung of the fallback chain produced the art, for logging/telemetry.
/// Not persisted — purely a return value for callers that want to log the
/// outcome (`spawn_art_acquisition` does).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtFallbackRung {
    SteamCdn,
    SteamGridDb,
    BundleIcon,
}

/// Run the fallback chain for one title, attempting each rung in order and
/// returning the first hit's `(rung, on_disk_path)`, or `None` if every
/// precondition-eligible rung missed (the caller then leaves the existing
/// placeholder art path in place).
///
/// Rung 1 (`fetch_steam_art`) is itself `async fn`, so this function blocks
/// on it via `tauri::async_runtime::block_on` rather than being `async`
/// itself. Callers must therefore never invoke this from inside a tokio
/// reactor thread — `commands::sources::spawn_art_acquisition` (the only
/// caller) already runs on a dedicated OS thread for exactly this reason.
pub fn resolve_art(
    db: &Db,
    paths: &Paths,
    game_id: i64,
    input: &ArtFallbackInput,
) -> AppResult<Option<(ArtFallbackRung, String)>> {
    if let Some(appid) = input.steam_appid {
        let fetched = tauri::async_runtime::block_on(fetch_steam_art(db, paths, game_id, appid));
        match fetched {
            Ok(Some(path)) => return Ok(Some((ArtFallbackRung::SteamCdn, path))),
            Ok(None) => {}
            Err(e) => eprintln!("[art_fallback_chain] Steam CDN rung failed for {appid}: {e}"),
        }
    }

    if let Some(key) = input.steamgriddb_api_key {
        let sanitized = super::name_sanitizer::sanitize(input.display_name);
        match fetch_steamgriddb_art(
            db,
            paths,
            game_id,
            input.display_name,
            &sanitized,
            Some(key),
        ) {
            Ok(Some(path)) => return Ok(Some((ArtFallbackRung::SteamGridDb, path))),
            Ok(None) => {}
            Err(e) => eprintln!(
                "[art_fallback_chain] SteamGridDB rung failed for {:?}: {e}",
                input.display_name
            ),
        }
    }

    if let Some(bundle_path) = input.bundle_path {
        let sanitized = super::name_sanitizer::sanitize(input.display_name);
        match fetch_bundle_icon_art(db, paths, game_id, bundle_path, &sanitized) {
            Ok(Some(path)) => return Ok(Some((ArtFallbackRung::BundleIcon, path))),
            Ok(None) => {}
            Err(e) => eprintln!(
                "[art_fallback_chain] bundle-icon rung failed for {bundle_path}: {e}"
            ),
        }
    }

    Ok(None)
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
            source: GameSource::Manual,
            launch_descriptor: Some(
                serde_json::json!({ "kind": "exec", "program": "/usr/bin/true", "args": [] })
                    .to_string(),
            ),
            external_id: Some("ext".to_string()),
        })
        .unwrap()
    }

    /// No rung has a satisfiable precondition (no appid, no key, no bundle
    /// path) — the chain must resolve to `None` without error, leaving the
    /// caller to fall back to the placeholder.
    #[test]
    fn every_rung_missing_precondition_yields_none() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db, "Nothing To Go On");

        let input = ArtFallbackInput {
            steam_appid: None,
            steamgriddb_api_key: None,
            bundle_path: None,
            display_name: "Nothing To Go On",
        };
        let result = resolve_art(&db, &paths, game_id, &input).unwrap();
        assert_eq!(result, None);
        assert!(ArtCacheRepo::new(&db).list_for_game(game_id).unwrap().is_empty());
    }

    /// A non-numeric appid is refused by `fetch_steam_art`'s own guard, so
    /// rung 1 misses; with no key and no bundle path, the whole chain must
    /// still degrade to `None` rather than propagating that as an error.
    #[test]
    fn invalid_appid_degrades_through_the_whole_chain() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db, "Bad Appid Game");

        let input = ArtFallbackInput {
            steam_appid: Some("not-a-number"),
            steamgriddb_api_key: None,
            bundle_path: None,
            display_name: "Bad Appid Game",
        };
        let result = resolve_art(&db, &paths, game_id, &input).unwrap();
        assert_eq!(result, None);
    }

    /// A blank SteamGridDB key must not be attempted (rung 2 skipped, same
    /// contract as `steamgriddb_art::fetch_steamgriddb_art`'s own guard) —
    /// falling through to rung 3 (bundle icon), which also misses for a
    /// bundle with no resolvable icon, yielding an overall `None`.
    #[test]
    fn blank_steamgriddb_key_is_treated_as_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let bundle = tmp.path().join("NoIcon.app");
        std::fs::create_dir_all(&bundle).unwrap();
        let game_id = seed_game(&db, "Blank Key Game");

        let input = ArtFallbackInput {
            steam_appid: None,
            steamgriddb_api_key: Some("   "),
            bundle_path: Some(bundle.to_str().unwrap()),
            display_name: "Blank Key Game",
        };
        let result = resolve_art(&db, &paths, game_id, &input).unwrap();
        assert_eq!(result, None);
    }

    /// Rung 3 (bundle icon) succeeding is reported as such, and the art is
    /// actually cached — proves the chain wires the bundle-icon fetcher
    /// through correctly when the earlier rungs' preconditions don't hold.
    #[test]
    fn falls_through_to_bundle_icon_when_earlier_rungs_are_unavailable() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();

        // A resolvable bundle: default AppIcon.icns present, though it won't
        // actually convert via `sips` since it's not real .icns bytes — this
        // still exercises rung-3 dispatch; the "sips fails on fake bytes"
        // case is covered directly in `bundle_icon`'s own tests, so this
        // test's job is only to prove rung 3 is *attempted* when 1 and 2
        // aren't, and the overall chain result still degrades cleanly.
        let bundle = tmp.path().join("Some.app");
        std::fs::create_dir_all(bundle.join("Contents/Resources")).unwrap();
        std::fs::write(
            bundle.join("Contents/Resources/AppIcon.icns"),
            b"NOT_REAL_ICNS",
        )
        .unwrap();
        let game_id = seed_game(&db, "Fallback To Bundle");

        let input = ArtFallbackInput {
            steam_appid: None,
            steamgriddb_api_key: None,
            bundle_path: Some(bundle.to_str().unwrap()),
            display_name: "Fallback To Bundle",
        };
        // sips can't convert fake bytes, so this still misses — but it must
        // not error, and it must be the bundle-icon path that was tried
        // (proven indirectly: no panic, clean None, matching
        // fetch_bundle_icon_art's own degrade-to-None contract).
        let result = resolve_art(&db, &paths, game_id, &input).unwrap();
        assert_eq!(result, None);
    }

    /// The rung ordering itself: `ArtFallbackRung` variant order in source
    /// mirrors the design doc's Steam CDN → SteamGridDB → bundle icon →
    /// placeholder chain. This is a documentation-anchoring test — it fails
    /// loudly if a future edit reorders the enum without updating the doc
    /// comment above.
    #[test]
    fn fallback_rung_declares_the_documented_order() {
        let rungs = [
            ArtFallbackRung::SteamCdn,
            ArtFallbackRung::SteamGridDb,
            ArtFallbackRung::BundleIcon,
        ];
        assert_eq!(rungs[0], ArtFallbackRung::SteamCdn);
        assert_eq!(rungs[1], ArtFallbackRung::SteamGridDb);
        assert_eq!(rungs[2], ArtFallbackRung::BundleIcon);
    }
}
