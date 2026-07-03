//! 3-tier art fallback orchestrator.
//!
//! Drives the fetch sequence for a game:
//!   Tier 1 — full No-Intro `clean_name` as boxart.
//!   Tier 2 — short name (everything before the first `(`) as boxart.
//!   Tier 3 — cycle through `Named_Titles` then `Named_Snaps` with full name.
//!
//! On a hit the PNG is stored via [`super::art_cache::ArtCacheService`] and the
//! on-disk path is returned. If all tiers miss, the caller surfaces a placeholder.
//!
//! All network calls go through the async CDN client; the orchestrator is async.

use super::art_cache::ArtCacheService;
use super::cdn_client::{build_cdn_url, fetch_png, system_to_cdn_folder, ArtTier};
use super::name_sanitizer::sanitize;
use crate::config::paths::Paths;
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// Attempt to fetch art for a game, trying every tier/name combination until
/// one succeeds or all fail.
///
/// Returns the on-disk path on success, or `None` when nothing is available
/// on the CDN (callers should then surface the placeholder).
///
/// Fallback sequence:
///   1. Full `clean_name` → `Named_Boxarts`
///   2. Short name (pre-`(` portion) → `Named_Boxarts`
///   3. Full `clean_name` → `Named_Titles`
///   4. Full `clean_name` → `Named_Snaps`
pub async fn fetch_with_fallback(
    db: &Db,
    paths: &Paths,
    game_id: i64,
    system: &str,
    clean_name: &str,
) -> AppResult<Option<String>> {
    let cdn_folder = match system_to_cdn_folder(system) {
        Some(f) => f,
        None => {
            return Err(AppError::Unsupported(format!(
                "no CDN folder mapping for system '{system}'"
            )))
        }
    };

    let svc = ArtCacheService::new(db, paths);
    let full_sanitized = sanitize(clean_name);
    let short_name = short_name(clean_name);
    let short_sanitized = sanitize(&short_name);

    // Tier 1: full name → boxart
    if let Some(path) = try_fetch(
        &svc,
        game_id,
        system,
        cdn_folder,
        ArtTier::Boxart,
        &full_sanitized,
    )
    .await?
    {
        return Ok(Some(path));
    }

    // Tier 2: short name → boxart (only if different)
    if short_sanitized != full_sanitized {
        if let Some(path) = try_fetch(
            &svc,
            game_id,
            system,
            cdn_folder,
            ArtTier::Boxart,
            &short_sanitized,
        )
        .await?
        {
            return Ok(Some(path));
        }
    }

    // Tier 3a: full name → title screen
    if let Some(path) = try_fetch(
        &svc,
        game_id,
        system,
        cdn_folder,
        ArtTier::Title,
        &full_sanitized,
    )
    .await?
    {
        return Ok(Some(path));
    }

    // Tier 3b: full name → snap
    if let Some(path) = try_fetch(
        &svc,
        game_id,
        system,
        cdn_folder,
        ArtTier::Snap,
        &full_sanitized,
    )
    .await?
    {
        return Ok(Some(path));
    }

    Ok(None)
}

/// Fetch and cache a SINGLE named tier for a game, independent of the other
/// tiers (W263 — per-tier hi-res pipeline).
///
/// Unlike [`fetch_with_fallback`] (which walks boxart → title → snap looking
/// for the first hit), this fetches exactly the requested `tier`, trying the
/// full No-Intro name first and — for [`ArtTier::Boxart`] only, matching the
/// existing 2-name convention — the short name second. Idempotent: re-running
/// it for a tier that is already cached simply re-fetches and overwrites
/// (`ArtCacheService::store` upserts), so callers can safely retry.
///
/// Returns `Ok(None)` when the CDN has no image for this tier under either
/// name variant (a graceful per-tier 404, e.g. a game with boxart but no
/// snap) — this is never an error. Returns `Err` only for a genuine
/// unsupported-system or transport failure.
pub async fn fetch_tier(
    db: &Db,
    paths: &Paths,
    game_id: i64,
    system: &str,
    clean_name: &str,
    tier: ArtTier,
) -> AppResult<Option<String>> {
    let cdn_folder = match system_to_cdn_folder(system) {
        Some(f) => f,
        None => {
            return Err(AppError::Unsupported(format!(
                "no CDN folder mapping for system '{system}'"
            )))
        }
    };

    let svc = ArtCacheService::new(db, paths);
    let full_sanitized = sanitize(clean_name);

    if let Some(path) = try_fetch(&svc, game_id, system, cdn_folder, tier, &full_sanitized).await?
    {
        return Ok(Some(path));
    }

    // Boxart alone gets the short-name second attempt (mirrors the 3-tier
    // fallback's tier-2 step); title/snap only ever use the full name.
    if tier == ArtTier::Boxart {
        let short_sanitized = sanitize(&short_name(clean_name));
        if short_sanitized != full_sanitized {
            if let Some(path) = try_fetch(
                &svc,
                game_id,
                system,
                cdn_folder,
                tier,
                &short_sanitized,
            )
            .await?
            {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

/// Try a single CDN fetch; store and return the path on hit, `None` on 404.
async fn try_fetch(
    svc: &ArtCacheService<'_>,
    game_id: i64,
    system: &str,
    cdn_folder: &str,
    tier: ArtTier,
    sanitized_name: &str,
) -> AppResult<Option<String>> {
    let url = build_cdn_url(cdn_folder, tier, sanitized_name);
    match fetch_png(&url).await? {
        Some(bytes) => {
            let path = svc.store(game_id, system, sanitized_name, tier.db_key(), &bytes)?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// Extract the short name: everything before the first ` (` or `(` in a
/// No-Intro title. Returns the trimmed result; falls back to the full name.
///
/// Examples:
///   "Super Mario Bros. 3 (USA)"           → "Super Mario Bros. 3"
///   "Castlevania: Symphony (USA) (Rev 1)" → "Castlevania: Symphony"
fn short_name(name: &str) -> String {
    if let Some(pos) = name.find(" (") {
        name[..pos].trim().to_string()
    } else if let Some(pos) = name.find('(') {
        name[..pos].trim().to_string()
    } else {
        name.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- short_name extraction ---

    #[test]
    fn short_name_strips_region_tag() {
        assert_eq!(short_name("Super Mario Bros. 3 (USA)"), "Super Mario Bros. 3");
    }

    #[test]
    fn short_name_strips_multiple_tags() {
        assert_eq!(
            short_name("Castlevania: Symphony of the Night (USA) (Rev 1)"),
            "Castlevania: Symphony of the Night"
        );
    }

    #[test]
    fn short_name_no_parens_returns_full() {
        assert_eq!(short_name("Tetris"), "Tetris");
    }

    #[test]
    fn short_name_trims_trailing_space() {
        assert_eq!(short_name("Zelda (USA)"), "Zelda");
    }

    // --- fallback tier ordering (via stub integration) ---

    /// Verifies the fallback sequence by tracking which URLs would be attempted.
    #[test]
    fn fallback_url_sequence_order() {
        // Build the URLs in the same order the orchestrator would try them.
        let system = "nes";
        let cdn_folder = system_to_cdn_folder(system).unwrap();
        let clean = "Super Mario Bros. 3 (USA)";
        let full_san = sanitize(clean);
        let short_san = sanitize(&short_name(clean));

        let urls: Vec<String> = vec![
            build_cdn_url(cdn_folder, ArtTier::Boxart, &full_san),
            build_cdn_url(cdn_folder, ArtTier::Boxart, &short_san),
            build_cdn_url(cdn_folder, ArtTier::Title, &full_san),
            build_cdn_url(cdn_folder, ArtTier::Snap, &full_san),
        ];

        // Boxart full name is first.
        assert!(urls[0].contains("Named_Boxarts"));
        assert!(urls[0].contains("Super%20Mario%20Bros.%203%20(USA)"));

        // Boxart short name is second — no "(USA)" region tag.
        assert!(urls[1].contains("Named_Boxarts"));
        assert!(urls[1].contains("Super%20Mario%20Bros.%203"));
        assert!(!urls[1].contains("(USA)"));

        // Title is third, snap is fourth.
        assert!(urls[2].contains("Named_Titles"));
        assert!(urls[3].contains("Named_Snaps"));
    }

    #[test]
    fn unsupported_system_would_return_error_variant() {
        // We can't call fetch_with_fallback without an async runtime here, but
        // the system_to_cdn_folder None branch documents the expected error.
        assert!(system_to_cdn_folder("unknown_xyz").is_none());
    }

    // --- fetch_tier URL construction (W263 per-tier pipeline) ---
    //
    // fetch_tier is async (drives the network client), so these tests exercise
    // the same pure name/URL construction it uses internally rather than
    // calling it directly — no network/runtime required, per the existing
    // pattern in `fallback_url_sequence_order` above.

    #[test]
    fn tier_url_uses_full_name_for_title_and_snap() {
        let system = "snes";
        let cdn_folder = system_to_cdn_folder(system).unwrap();
        let clean = "Super Metroid";
        let full_san = sanitize(clean);

        let title_url = build_cdn_url(cdn_folder, ArtTier::Title, &full_san);
        let snap_url = build_cdn_url(cdn_folder, ArtTier::Snap, &full_san);

        assert!(title_url.contains("Named_Titles"));
        assert!(title_url.contains("Super%20Metroid"));
        assert!(snap_url.contains("Named_Snaps"));
        assert!(snap_url.contains("Super%20Metroid"));
    }

    #[test]
    fn tier_url_boxart_full_name_first_attempt() {
        let system = "nes";
        let cdn_folder = system_to_cdn_folder(system).unwrap();
        let clean = "Super Mario Bros. 3 (USA)";
        let full_san = sanitize(clean);

        let url = build_cdn_url(cdn_folder, ArtTier::Boxart, &full_san);
        assert!(url.contains("Named_Boxarts"));
        assert!(url.contains("(USA)"));
    }

    #[test]
    fn tier_url_boxart_short_name_second_attempt_differs_from_full() {
        let clean = "Castlevania: Symphony of the Night (USA) (Rev 1)";
        let full_san = sanitize(clean);
        let short_san = sanitize(&short_name(clean));

        // The short-name retry only fires when it differs from the full name —
        // exactly the branch fetch_tier guards on.
        assert_ne!(full_san, short_san);
        assert!(!short_san.contains("Rev"));
    }

    #[test]
    fn tier_url_boxart_short_name_skipped_when_identical_to_full() {
        // "Tetris" has no parenthetical suffix, so short_name == clean_name and
        // fetch_tier must skip the redundant second attempt.
        let clean = "Tetris";
        let full_san = sanitize(clean);
        let short_san = sanitize(&short_name(clean));
        assert_eq!(full_san, short_san);
    }
}
