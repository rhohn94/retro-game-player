//! libretro-thumbnails CDN client.
//!
//! Downloads boxart PNGs from the canonical CDN:
//!   `https://thumbnails.libretro.com/<System>/Named_Boxarts/<Game>.png`
//!
//! Also supports the fallback sub-directories:
//!   `Named_Titles`  — title screen shots
//!   `Named_Snaps`   — gameplay snapshots
//!
//! The caller drives the 3-tier fallback sequence via [`ArtTier`]; this module
//! handles only the network round-trip. Mapping system slugs to CDN system
//! folder names is also centralised here via [`system_to_cdn_folder`].

use crate::error::{AppError, AppResult};
use std::time::Duration;

/// CDN base URL for libretro thumbnails.
pub const CDN_BASE_URL: &str = "https://thumbnails.libretro.com";

/// Timeout for a single CDN request (10 seconds).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Art tier — determines which CDN sub-directory is queried.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtTier {
    /// Named_Boxarts — preferred tier.
    Boxart,
    /// Named_Titles — fallback tier 2.
    Title,
    /// Named_Snaps — fallback tier 3.
    Snap,
}

impl ArtTier {
    /// CDN sub-directory name for this tier.
    pub fn cdn_dir(&self) -> &'static str {
        match self {
            ArtTier::Boxart => "Named_Boxarts",
            ArtTier::Title => "Named_Titles",
            ArtTier::Snap => "Named_Snaps",
        }
    }

    /// Database `tier` column value for this tier (matches `art_cache.tier`).
    pub fn db_key(&self) -> &'static str {
        match self {
            ArtTier::Boxart => "boxart",
            ArtTier::Title => "title",
            ArtTier::Snap => "snap",
        }
    }

    /// Ordered fallback sequence: boxart → title → snap.
    pub fn fallback_sequence() -> &'static [ArtTier] {
        &[ArtTier::Boxart, ArtTier::Title, ArtTier::Snap]
    }
}

/// Map an internal Harmony system slug to the CDN folder name used by
/// libretro-thumbnails. Returns `None` for unknown/unsupported systems.
pub fn system_to_cdn_folder(system: &str) -> Option<&'static str> {
    match system {
        "nes" => Some("Nintendo - Nintendo Entertainment System"),
        "snes" => Some("Nintendo - Super Nintendo Entertainment System"),
        "n64" => Some("Nintendo - Nintendo 64"),
        "gb" => Some("Nintendo - Game Boy"),
        "gbc" => Some("Nintendo - Game Boy Color"),
        "gba" => Some("Nintendo - Game Boy Advance"),
        "nds" => Some("Nintendo - Nintendo DS"),
        "3ds" => Some("Nintendo - Nintendo 3DS"),
        "gamecube" => Some("Nintendo - GameCube"),
        "wii" => Some("Nintendo - Wii"),
        "sega_genesis" | "genesis" | "md" => Some("Sega - Mega Drive - Genesis"),
        "sega_cd" => Some("Sega - Mega-CD - Sega CD"),
        "sega_32x" => Some("Sega - 32X"),
        "sega_saturn" => Some("Sega - Saturn"),
        "sega_dreamcast" | "dreamcast" => Some("Sega - Dreamcast"),
        "sega_master_system" | "sms" => Some("Sega - Master System - Mark III"),
        "sega_game_gear" | "gg" => Some("Sega - Game Gear"),
        "ps1" | "psx" => Some("Sony - PlayStation"),
        "ps2" => Some("Sony - PlayStation 2"),
        "psp" => Some("Sony - PlayStation Portable"),
        "atari2600" => Some("Atari - 2600"),
        "atari7800" => Some("Atari - 7800"),
        "atari_lynx" => Some("Atari - Lynx"),
        "neogeo" => Some("SNK - Neo Geo"),
        "neogeo_pocket" => Some("SNK - Neo Geo Pocket"),
        "neogeo_pocket_color" => Some("SNK - Neo Geo Pocket Color"),
        "pcengine" | "turbografx16" => Some("NEC - PC Engine - TurboGrafx 16"),
        "pcengine_cd" => Some("NEC - PC Engine CD - TurboGrafx-CD"),
        _ => None,
    }
}

/// Build the CDN URL for a given system, tier, and sanitized game name.
///
/// `sanitized_name` must already be percent-encoded (via [`super::name_sanitizer::sanitize`]).
pub fn build_cdn_url(cdn_folder: &str, tier: ArtTier, sanitized_name: &str) -> String {
    format!(
        "{}/{}/{}/{}.png",
        CDN_BASE_URL,
        cdn_folder,
        tier.cdn_dir(),
        sanitized_name
    )
}

/// Download a PNG from `url` and return its raw bytes.
///
/// Returns `Ok(None)` on HTTP 404 (art not available for this tier) and
/// `Err(AppError::Network)` on any other transport or HTTP failure.
///
/// # Testing note
/// In unit tests this function is not called — tests inject bytes directly via
/// the cache layer. Network round-trips are integration-test territory only.
pub async fn fetch_png(url: &str) -> AppResult<Option<Vec<u8>>> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| AppError::Network(format!("failed to build HTTP client: {e}")))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("CDN request failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "CDN returned HTTP {} for {}",
            resp.status(),
            url
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("failed to read CDN response body: {e}")))?;

    Ok(Some(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn art_tier_db_keys_are_expected_values() {
        assert_eq!(ArtTier::Boxart.db_key(), "boxart");
        assert_eq!(ArtTier::Title.db_key(), "title");
        assert_eq!(ArtTier::Snap.db_key(), "snap");
    }

    #[test]
    fn fallback_sequence_order() {
        let seq = ArtTier::fallback_sequence();
        assert_eq!(seq[0], ArtTier::Boxart);
        assert_eq!(seq[1], ArtTier::Title);
        assert_eq!(seq[2], ArtTier::Snap);
    }

    #[test]
    fn build_cdn_url_format() {
        let url = build_cdn_url(
            "Nintendo - Nintendo Entertainment System",
            ArtTier::Boxart,
            "Super%20Mario%20Bros.",
        );
        assert_eq!(
            url,
            "https://thumbnails.libretro.com/Nintendo - Nintendo Entertainment System/Named_Boxarts/Super%20Mario%20Bros..png"
        );
    }

    #[test]
    fn known_systems_map_to_cdn_folder() {
        assert!(system_to_cdn_folder("nes").is_some());
        assert!(system_to_cdn_folder("snes").is_some());
        assert!(system_to_cdn_folder("n64").is_some());
        assert!(system_to_cdn_folder("ps1").is_some());
    }

    #[test]
    fn unknown_system_returns_none() {
        assert!(system_to_cdn_folder("unknown_system_xyz").is_none());
    }
}
