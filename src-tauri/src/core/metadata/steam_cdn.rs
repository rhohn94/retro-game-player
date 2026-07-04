//! Steam public art CDN client (v0.31 W314 — see
//! `docs/design/non-retro-library-design.md` §Art & metadata).
//!
//! Downloads shelf/library/hero art for a Steam title keyed on its appid from
//! the public, unauthenticated CDN:
//!   `https://steamcdn-a.akamaihd.net/steam/apps/<appid>/<asset>`
//!
//! Mirrors the shape of [`super::cdn_client`] (the libretro-thumbnails
//! client): this module owns only the URL construction + network round-trip;
//! [`super::steam_art::fetch_steam_art`] drives the fetch/cache orchestration
//! through the existing [`super::art_cache::ArtCacheService`].

use crate::error::{AppError, AppResult};
use std::time::Duration;

/// CDN base URL for Steam's public per-app art assets.
pub const STEAM_CDN_BASE_URL: &str = "https://steamcdn-a.akamaihd.net/steam/apps";

/// Timeout for a single CDN request (10 seconds) — matches the
/// libretro-thumbnails client's budget.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Which Steam CDN asset to fetch for an appid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SteamArtAsset {
    /// `header.jpg` — the classic store-page banner; used as shelf art.
    Header,
    /// `library_600x900_2x.jpg` — portrait library capsule; used as boxart-tier art.
    LibraryPortrait,
    /// `library_hero.jpg` — wide hero banner; used for TV-mode hero surfaces.
    LibraryHero,
}

impl SteamArtAsset {
    /// CDN filename for this asset.
    pub fn filename(&self) -> &'static str {
        match self {
            SteamArtAsset::Header => "header.jpg",
            SteamArtAsset::LibraryPortrait => "library_600x900_2x.jpg",
            SteamArtAsset::LibraryHero => "library_hero.jpg",
        }
    }

    /// `art_cache.tier` DB key for this asset — reuses the existing
    /// boxart/title/snap vocabulary so the shared cache/priority machinery
    /// ([`super::art_cache::ArtCacheService`]) needs no Steam-specific branch:
    /// portrait capsule maps to the shelf-preferred `boxart` tier, header to
    /// `title`, hero to `snap` (lowest display priority, used for wide TV
    /// backgrounds rather than the shelf thumbnail).
    pub fn db_key(&self) -> &'static str {
        match self {
            SteamArtAsset::LibraryPortrait => "boxart",
            SteamArtAsset::Header => "title",
            SteamArtAsset::LibraryHero => "snap",
        }
    }

    /// Fetch priority order: portrait capsule first (best shelf fit), then
    /// header, then hero.
    pub fn fetch_sequence() -> &'static [SteamArtAsset] {
        &[
            SteamArtAsset::LibraryPortrait,
            SteamArtAsset::Header,
            SteamArtAsset::LibraryHero,
        ]
    }
}

/// Build the CDN URL for `appid`'s `asset`.
pub fn build_steam_art_url(appid: &str, asset: SteamArtAsset) -> String {
    format!("{}/{}/{}", STEAM_CDN_BASE_URL, appid, asset.filename())
}

/// Download an image from `url` and return its raw bytes.
///
/// Returns `Ok(None)` on HTTP 404 (this asset doesn't exist for the appid —
/// a graceful per-asset miss) and `Err(AppError::Network)` on any other
/// transport or HTTP failure. Callers must treat `Err` as non-fatal too (W314
/// acceptance: network failure degrades to placeholder, never surfaces to
/// the scan) — see [`super::steam_art::fetch_steam_art`].
///
/// # Testing note
/// Not exercised in unit tests directly (network round-trip); tests inject
/// bytes at the cache layer, mirroring [`super::cdn_client::fetch_png`].
pub async fn fetch_image(url: &str) -> AppResult<Option<Vec<u8>>> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| AppError::Network(format!("failed to build HTTP client: {e}")))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Steam CDN request failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "Steam CDN returned HTTP {} for {}",
            resp.status(),
            url
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("failed to read Steam CDN response body: {e}")))?;

    Ok(Some(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_filenames_match_steam_cdn_convention() {
        assert_eq!(SteamArtAsset::Header.filename(), "header.jpg");
        assert_eq!(
            SteamArtAsset::LibraryPortrait.filename(),
            "library_600x900_2x.jpg"
        );
        assert_eq!(SteamArtAsset::LibraryHero.filename(), "library_hero.jpg");
    }

    #[test]
    fn asset_db_keys_reuse_existing_tier_vocabulary() {
        assert_eq!(SteamArtAsset::LibraryPortrait.db_key(), "boxart");
        assert_eq!(SteamArtAsset::Header.db_key(), "title");
        assert_eq!(SteamArtAsset::LibraryHero.db_key(), "snap");
    }

    #[test]
    fn build_steam_art_url_format() {
        let url = build_steam_art_url("620", SteamArtAsset::Header);
        assert_eq!(
            url,
            "https://steamcdn-a.akamaihd.net/steam/apps/620/header.jpg"
        );
    }

    #[test]
    fn fetch_sequence_prefers_portrait_capsule_first() {
        let seq = SteamArtAsset::fetch_sequence();
        assert_eq!(seq[0], SteamArtAsset::LibraryPortrait);
        assert_eq!(seq[1], SteamArtAsset::Header);
        assert_eq!(seq[2], SteamArtAsset::LibraryHero);
    }
}
