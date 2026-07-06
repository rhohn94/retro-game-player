//! App configuration: the typed [`AppConfig`] model plus load/save against
//! `config/app-config.json` (§4.1). Distinct from the per-key `settings` DB
//! table (§3) — `AppConfig` holds bootstrap-time, file-backed settings the app
//! needs before/around the DB (RetroArch path, Familiar base URL). The
//! canonical location is resolved by [`paths::Paths`]; nothing hard-codes it.
//!
//! Open question OQ-1 (architecture-design.md): typed-vs-`JsonValue` settings —
//! `AppConfig` deliberately uses named typed fields with defaults; the dynamic
//! `settings` table covers the open-ended case.

pub mod migrate;
pub mod paths;

use crate::error::AppResult;
use paths::Paths;
use serde::{Deserialize, Serialize};

/// Current `AppConfig` schema version. Bumped when fields change shape so a
/// future migration can adapt older on-disk files forward-compatibly.
pub const CONFIG_SCHEMA_VERSION: u32 = 1;

/// Default Familiar enrichment base URL (no magic strings at call sites).
pub const DEFAULT_FAMILIAR_BASE_URL: &str = "http://127.0.0.1:2121";

/// File-backed application configuration. `#[serde(default)]` makes every field
/// optional on disk so older/partial files load cleanly and forward-compatibly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct AppConfig {
    /// Schema version of this config payload.
    pub schema_version: u32,
    /// Absolute path to the RetroArch executable, if the user has set/located
    /// it. `None` until resolved (W7 may auto-locate and persist).
    pub retroarch_path: Option<String>,
    /// Base URL of the Familiar enrichment service (W12).
    pub familiar_base_url: String,
    /// Whether to launch games fullscreen by default.
    pub launch_fullscreen: bool,
    /// Absolute path to the games directory Retro Game Player created for the
    /// user, if any
    /// (W51). `None` until the user accepts the "create a games folder" offer.
    pub games_dir: Option<String>,
    /// Native libretro core hosting for NES instead of the in-page
    /// EmulatorJS/WASM player (v0.21 "Bedrock", W215). **On by default since
    /// v0.24 (W240)** — audio cleanliness and gameplay smoothness were both
    /// confirmed on-device (2026-07-01, post-W233/W239). A persisted `false`
    /// (user opt-out) is respected; native init failure for any reason falls
    /// back to EmulatorJS automatically regardless of this flag's value.
    pub native_play_enabled: bool,
    /// In-game audio volume [0, 1], applied on both play paths and persisted
    /// from the overlay's volume control (v0.24 W243, #22).
    pub player_volume: f32,
    /// Pause the running game when the Retro Game Player window loses focus, resuming
    /// on refocus (v0.24 W243, #22). On by default.
    pub pause_on_blur: bool,
    /// Land directly in TV mode (the 10-foot leanback shell, fullscreen) on a
    /// fresh launch instead of the desktop library (v0.26 W260,
    /// tv-mode-design.md §Auto-enter). Off by default — TV mode is opt-in.
    pub auto_tv_mode: bool,
    /// CRT presentation filter config (v0.29 W280, crt-filter-design.md),
    /// shared verbatim by both play paths (native WebGL2 shader, EJS CSS
    /// approximation).
    pub crt_filter: CrtFilterConfig,
    /// Show the optional on-screen FPS counter on both play paths (v0.29
    /// W281, performance-tooling-design.md). Off by default — an opt-in
    /// diagnostic overlay, not a surprise addition to the play surface.
    pub show_fps_counter: bool,
    /// User-supplied SteamGridDB API key (v0.32 W321,
    /// non-retro-library-design.md §SteamGridDB art). `None` until the user
    /// enters one in Settings → Game Sources; the SteamGridDB art-fallback
    /// rung is fully inert without it — scans and shelves behave exactly as
    /// v0.31 (no SteamGridDB requests attempted at all).
    pub steamgriddb_api_key: Option<String>,
    /// User-supplied RetroAchievements username (v0.37 W371,
    /// retroachievements-design.md §Client + accounts). `None` until the
    /// user enters one in Settings → RetroAchievements. Not a secret (unlike
    /// the Web API key, which lives in the Keychain via `KeyStore`) — the
    /// whole RA feature is inert without both a username and a stored key.
    pub retroachievements_username: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            retroarch_path: None,
            familiar_base_url: DEFAULT_FAMILIAR_BASE_URL.to_string(),
            launch_fullscreen: true,
            games_dir: None,
            native_play_enabled: true,
            player_volume: 1.0,
            pause_on_blur: true,
            auto_tv_mode: false,
            crt_filter: CrtFilterConfig::default(),
            show_fps_counter: false,
            steamgriddb_api_key: None,
            retroachievements_username: None,
        }
    }
}

/// One named CRT-filter preset — a fixed quadruple of effect intensities
/// (crt-filter-design.md's four named presets: Off / Classic CRT / Arcade
/// Cabinet / Sharp). Kept as plain `u8` constants rather than a lookup table
/// so the mapping is visible at a glance and trivially unit-testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrtPreset {
    Off,
    Classic,
    Arcade,
    Sharp,
}

impl CrtPreset {
    /// The four intensities (scanlines, curvature, color bleed, vignette)
    /// this preset resolves to, each already clamped into [0, 100].
    pub fn intensities(self) -> (u8, u8, u8, u8) {
        match self {
            // Every effect off — an escape hatch back to the plain image.
            CrtPreset::Off => (0, 0, 0, 0),
            // A believable consumer CRT: visible scanlines and a little
            // color bleed and vignette, mild curvature (a TV, not a fishbowl).
            CrtPreset::Classic => (55, 25, 35, 30),
            // A stronger, more theatrical arcade-cabinet monitor: heavier
            // curvature and vignette, bold scanlines.
            CrtPreset::Arcade => (70, 55, 45, 55),
            // A light, "just enough to read as CRT" look — mostly scanlines,
            // negligible curvature/bleed/vignette.
            CrtPreset::Sharp => (20, 0, 10, 10),
        }
    }
}

/// CRT presentation-filter configuration (v0.29 W280, crt-filter-design.md).
/// One shared shape consumed identically by the native WebGL2 pipeline
/// (`NativePlayer.tsx`) and the EJS CSS approximation (`InPagePlayer.tsx`) —
/// per-effect intensity is [0, 100]; `preset` records the last-applied named
/// preset (or `None` once the user free-tweaks a slider away from it) purely
/// so the settings panel can highlight which preset (if any) is active.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CrtFilterConfig {
    /// Scanline intensity [0, 100].
    pub scanlines: u8,
    /// Barrel/curvature warp intensity [0, 100].
    pub curvature: u8,
    /// RGB channel-offset color-bleed intensity [0, 100].
    pub color_bleed: u8,
    /// Vignette darkening intensity [0, 100].
    pub vignette: u8,
    /// The named preset this config currently matches, if any (`None` once a
    /// slider has been dragged away from every preset's exact quadruple).
    pub preset: Option<CrtPreset>,
}

impl Default for CrtFilterConfig {
    /// Ships with the filter off — an opt-in presentation layer, not a
    /// surprise default (mirrors `auto_tv_mode`'s off-by-default posture).
    fn default() -> Self {
        Self::from_preset(CrtPreset::Off)
    }
}

impl CrtFilterConfig {
    /// Builds a config from one of the four named presets.
    pub fn from_preset(preset: CrtPreset) -> Self {
        let (scanlines, curvature, color_bleed, vignette) = preset.intensities();
        Self {
            scanlines,
            curvature,
            color_bleed,
            vignette,
            preset: Some(preset),
        }
    }

    /// Clamps every intensity into [0, 100] — the IPC boundary shouldn't
    /// trust a slider value verbatim any more than `player_prefs` trusts a
    /// raw volume float.
    pub fn clamped(self) -> Self {
        Self {
            scanlines: self.scanlines.min(100),
            curvature: self.curvature.min(100),
            color_bleed: self.color_bleed.min(100),
            vignette: self.vignette.min(100),
            preset: self.preset,
        }
    }
}

impl AppConfig {
    /// Load the config from `config/app-config.json`. A missing file yields
    /// [`AppConfig::default`] (first run); a present-but-unreadable or malformed
    /// file surfaces an [`crate::error::AppError`].
    pub fn load(paths: &Paths) -> AppResult<Self> {
        let file = paths.app_config_file()?;
        if !file.exists() {
            return Ok(Self::default());
        }
        let bytes = std::fs::read(&file)?;
        let cfg: AppConfig = serde_json::from_slice(&bytes)?;
        Ok(cfg)
    }

    /// Persist the config to `config/app-config.json` (pretty-printed). The
    /// parent `config/` dir is created by the path resolver.
    pub fn save(&self, paths: &Paths) -> AppResult<()> {
        let file = paths.app_config_file()?;
        let json = serde_json::to_vec_pretty(self)?;
        std::fs::write(&file, json)?;
        Ok(())
    }

    /// Load the config, then write it back. Ensures a well-formed file exists on
    /// disk (materializing defaults on first run). Returns the effective config.
    pub fn load_or_init(paths: &Paths) -> AppResult<Self> {
        let cfg = Self::load(paths)?;
        cfg.save(paths)?;
        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(tag: &str) -> (Paths, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!("rgp-config-{tag}-{}", std::process::id()));
        let p = Paths::with_root(tmp.join(paths::BUNDLE_ID)).expect("root");
        (p, tmp)
    }

    #[test]
    fn default_has_sensible_values() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.schema_version, CONFIG_SCHEMA_VERSION);
        assert_eq!(cfg.familiar_base_url, DEFAULT_FAMILIAR_BASE_URL);
        assert!(cfg.retroarch_path.is_none());
        assert!(cfg.launch_fullscreen);
        assert!(cfg.games_dir.is_none());
        assert!(cfg.native_play_enabled); // on by default since v0.24 (W240)
        assert_eq!(cfg.player_volume, 1.0);
        assert!(cfg.pause_on_blur);
        assert!(!cfg.auto_tv_mode); // TV mode is opt-in (v0.26 W260)
        assert_eq!(cfg.crt_filter, CrtFilterConfig::default()); // off by default (v0.29 W280)
        assert!(!cfg.show_fps_counter); // opt-in diagnostic overlay (v0.29 W281)
        assert!(cfg.steamgriddb_api_key.is_none()); // inert until configured (v0.32 W321)
        assert!(cfg.retroachievements_username.is_none()); // inert until configured (v0.37 W371)
    }

    #[test]
    fn steamgriddb_api_key_round_trips() {
        let (paths, tmp) = temp_paths("steamgriddb-api-key");
        let cfg = AppConfig {
            steamgriddb_api_key: Some("sgdb-test-key".to_string()),
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");
        let loaded = AppConfig::load(&paths).expect("load");
        assert_eq!(loaded.steamgriddb_api_key.as_deref(), Some("sgdb-test-key"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn retroachievements_username_round_trips() {
        let (paths, tmp) = temp_paths("retroachievements-username");
        let cfg = AppConfig {
            retroachievements_username: Some("RaUser42".to_string()),
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");
        let loaded = AppConfig::load(&paths).expect("load");
        assert_eq!(loaded.retroachievements_username.as_deref(), Some("RaUser42"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn show_fps_counter_round_trips() {
        let (paths, tmp) = temp_paths("show-fps-counter");
        let cfg = AppConfig {
            show_fps_counter: true,
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");
        let loaded = AppConfig::load(&paths).expect("load");
        assert!(loaded.show_fps_counter);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn auto_tv_mode_round_trips() {
        let (paths, tmp) = temp_paths("auto-tv-mode");
        let cfg = AppConfig {
            auto_tv_mode: true,
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");
        let loaded = AppConfig::load(&paths).expect("load");
        assert!(loaded.auto_tv_mode);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn player_prefs_round_trip() {
        let (paths, tmp) = temp_paths("player-prefs");
        let cfg = AppConfig {
            player_volume: 0.35,
            pause_on_blur: false,
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");
        let loaded = AppConfig::load(&paths).expect("load");
        assert_eq!(loaded.player_volume, 0.35);
        assert!(!loaded.pause_on_blur);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn native_play_enabled_round_trips() {
        // A persisted opt-out must survive load — the new-in-v0.24 `true`
        // default only applies to configs that never stored the field's value.
        let (paths, tmp) = temp_paths("native-play-enabled");
        let cfg = AppConfig {
            native_play_enabled: false,
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");
        let loaded = AppConfig::load(&paths).expect("load");
        assert!(!loaded.native_play_enabled);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn games_dir_round_trips() {
        let (paths, tmp) = temp_paths("games-dir");
        let cfg = AppConfig {
            games_dir: Some("/Users/me/Games".to_string()),
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");
        let loaded = AppConfig::load(&paths).expect("load");
        assert_eq!(loaded.games_dir.as_deref(), Some("/Users/me/Games"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn load_missing_returns_default() {
        let (paths, tmp) = temp_paths("missing");
        let cfg = AppConfig::load(&paths).expect("load");
        assert_eq!(cfg, AppConfig::default());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_then_load_round_trips() {
        let (paths, tmp) = temp_paths("roundtrip");
        let cfg = AppConfig {
            retroarch_path: Some("/Applications/RetroArch.app".to_string()),
            launch_fullscreen: false,
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");

        let loaded = AppConfig::load(&paths).expect("load");
        assert_eq!(loaded, cfg);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn load_or_init_materializes_file() {
        let (paths, tmp) = temp_paths("init");
        let cfg = AppConfig::load_or_init(&paths).expect("init");
        assert_eq!(cfg, AppConfig::default());
        assert!(paths.app_config_file().unwrap().exists());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn crt_filter_round_trips() {
        let (paths, tmp) = temp_paths("crt-filter");
        let cfg = AppConfig {
            crt_filter: CrtFilterConfig::from_preset(CrtPreset::Arcade),
            ..AppConfig::default()
        };
        cfg.save(&paths).expect("save");
        let loaded = AppConfig::load(&paths).expect("load");
        assert_eq!(loaded.crt_filter, CrtFilterConfig::from_preset(CrtPreset::Arcade));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn crt_filter_off_preset_is_all_zero() {
        assert_eq!(CrtPreset::Off.intensities(), (0, 0, 0, 0));
    }

    #[test]
    fn crt_filter_default_is_off_preset() {
        let cfg = CrtFilterConfig::default();
        assert_eq!(cfg.preset, Some(CrtPreset::Off));
        assert_eq!(cfg.scanlines, 0);
        assert_eq!(cfg.curvature, 0);
        assert_eq!(cfg.color_bleed, 0);
        assert_eq!(cfg.vignette, 0);
    }

    #[test]
    fn crt_filter_every_preset_intensity_is_in_bounds() {
        for preset in [
            CrtPreset::Off,
            CrtPreset::Classic,
            CrtPreset::Arcade,
            CrtPreset::Sharp,
        ] {
            let (s, c, b, v) = preset.intensities();
            for value in [s, c, b, v] {
                assert!(value <= 100, "{preset:?} intensity {value} out of [0,100]");
            }
        }
    }

    #[test]
    fn crt_filter_clamped_caps_out_of_range_intensities() {
        let cfg = CrtFilterConfig {
            scanlines: 255,
            curvature: 101,
            color_bleed: 100,
            vignette: 0,
            preset: None,
        }
        .clamped();
        assert_eq!(cfg.scanlines, 100);
        assert_eq!(cfg.curvature, 100);
        assert_eq!(cfg.color_bleed, 100);
        assert_eq!(cfg.vignette, 0);
    }

    #[test]
    fn crt_filter_missing_field_in_partial_file_defaults_to_off() {
        let (paths, tmp) = temp_paths("crt-filter-partial");
        std::fs::write(paths.app_config_file().unwrap(), br#"{"retroarch_path":"/x"}"#).unwrap();
        let cfg = AppConfig::load(&paths).expect("load");
        assert_eq!(cfg.crt_filter, CrtFilterConfig::default());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn partial_file_fills_defaults() {
        let (paths, tmp) = temp_paths("partial");
        std::fs::write(
            paths.app_config_file().unwrap(),
            br#"{"retroarch_path":"/x"}"#,
        )
        .unwrap();
        let cfg = AppConfig::load(&paths).expect("load");
        assert_eq!(cfg.retroarch_path.as_deref(), Some("/x"));
        assert_eq!(cfg.familiar_base_url, DEFAULT_FAMILIAR_BASE_URL);
        std::fs::remove_dir_all(&tmp).ok();
    }
}
