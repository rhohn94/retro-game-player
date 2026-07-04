//! CRT filter config IPC (v0.29 W280, crt-filter-design.md): one shared
//! per-effect intensity + preset shape persisted in [`AppConfig`] and applied
//! identically by both play paths (the native WebGL2 shader and the EJS CSS
//! approximation) — mirrors the shape and conventions of
//! `commands::player_prefs`.

use crate::config::{paths::Paths, AppConfig, CrtFilterConfig, CrtPreset};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

/// The persisted CRT filter config, camelCased for the frontend (mirrors the
/// frontend's `CrtFilterConfig` in `src/features/play/crtFilter.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrtFilterDto {
    pub scanlines: u8,
    pub curvature: u8,
    pub color_bleed: u8,
    pub vignette: u8,
    pub preset: Option<CrtPreset>,
}

impl From<CrtFilterConfig> for CrtFilterDto {
    fn from(c: CrtFilterConfig) -> Self {
        Self {
            scanlines: c.scanlines,
            curvature: c.curvature,
            color_bleed: c.color_bleed,
            vignette: c.vignette,
            preset: c.preset,
        }
    }
}

impl From<CrtFilterDto> for CrtFilterConfig {
    fn from(d: CrtFilterDto) -> Self {
        Self {
            scanlines: d.scanlines,
            curvature: d.curvature,
            color_bleed: d.color_bleed,
            vignette: d.vignette,
            preset: d.preset,
        }
        .clamped()
    }
}

/// The current CRT filter config (defaults to the `Off` preset — v0.29
/// W280, an opt-in presentation layer, not a surprise default).
#[tauri::command]
pub fn get_crt_filter() -> AppResult<CrtFilterDto> {
    let cfg = AppConfig::load(&Paths::app_support()?)?;
    Ok(cfg.crt_filter.into())
}

/// Persists the CRT filter config. Intensities are clamped to [0, 100]
/// backend-side — the UI's sliders can't exceed it, but the IPC boundary
/// shouldn't trust that (same posture as `set_player_prefs`'s volume clamp).
#[tauri::command]
pub fn set_crt_filter(config: CrtFilterDto) -> AppResult<()> {
    let paths = Paths::app_support()?;
    let mut cfg = AppConfig::load(&paths)?;
    cfg.crt_filter = config.into();
    cfg.save(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dto_round_trips_through_config() {
        let dto = CrtFilterDto {
            scanlines: 40,
            curvature: 20,
            color_bleed: 10,
            vignette: 5,
            preset: None,
        };
        let cfg: CrtFilterConfig = dto.into();
        let back: CrtFilterDto = cfg.into();
        assert_eq!(back, dto);
    }

    #[test]
    fn dto_conversion_clamps_out_of_range_intensities() {
        let dto = CrtFilterDto {
            scanlines: 255,
            curvature: 0,
            color_bleed: 0,
            vignette: 0,
            preset: None,
        };
        let cfg: CrtFilterConfig = dto.into();
        assert_eq!(cfg.scanlines, 100);
    }

    #[test]
    fn preset_dto_round_trips() {
        let cfg = CrtFilterConfig::from_preset(CrtPreset::Classic);
        let dto: CrtFilterDto = cfg.into();
        assert_eq!(dto.preset, Some(CrtPreset::Classic));
        let back: CrtFilterConfig = dto.into();
        assert_eq!(back, cfg);
    }

    // ---- W284 (issue #28): get_crt_filter / set_crt_filter IPC contract ----
    //
    // Both commands take no `tauri::State` (they resolve `Paths::app_support()`
    // internally, matching `commands::player_prefs`'s convention) so they
    // can't be pointed at an isolated on-disk root from a test — calling the
    // real `#[tauri::command]` fns here would read/write the developer
    // machine's real app-support dir, a hazard every other test in this crate
    // avoids (see `config::mod`'s own `temp_paths` helper doc). These tests
    // instead exercise get_crt_filter/set_crt_filter's *exact* body — load,
    // convert, save/convert-back — against an isolated `Paths::with_root`,
    // proving the full persisted round trip the commands perform end to end
    // (not just the in-memory DTO<->config conversion the tests above cover).

    fn temp_paths(tag: &str) -> (Paths, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!("rgp-crt-filter-cmd-{tag}-{}", std::process::id()));
        let p = Paths::with_root(tmp.join(crate::config::paths::BUNDLE_ID)).expect("root");
        (p, tmp)
    }

    /// Mirrors `get_crt_filter`'s exact body against an isolated root.
    fn get_crt_filter_at(paths: &Paths) -> AppResult<CrtFilterDto> {
        let cfg = AppConfig::load(paths)?;
        Ok(cfg.crt_filter.into())
    }

    /// Mirrors `set_crt_filter`'s exact body against an isolated root.
    fn set_crt_filter_at(paths: &Paths, config: CrtFilterDto) -> AppResult<()> {
        let mut cfg = AppConfig::load(paths)?;
        cfg.crt_filter = config.into();
        cfg.save(paths)
    }

    #[test]
    fn get_crt_filter_on_a_fresh_install_returns_the_off_default() {
        let (paths, tmp) = temp_paths("fresh");
        let dto = get_crt_filter_at(&paths).expect("get");
        assert_eq!(dto, CrtFilterDto::from(CrtFilterConfig::default()));
        // `CrtFilterConfig::default()` is `from_preset(Off)` (mod.rs), which
        // stamps `preset: Some(Off)` — a real named preset, not "no preset
        // selected" — so a fresh install's DTO must reflect that, not `None`.
        assert_eq!(dto.preset, Some(CrtPreset::Off));
        assert_eq!(dto.scanlines, 0);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn set_then_get_crt_filter_round_trips_a_real_persisted_value() {
        let (paths, tmp) = temp_paths("round-trip");
        let dto = CrtFilterDto {
            scanlines: 65,
            curvature: 30,
            color_bleed: 15,
            vignette: 50,
            preset: None,
        };
        set_crt_filter_at(&paths, dto).expect("set");

        // A fresh load (new AppConfig::load call, matching a fresh IPC round
        // trip) must see exactly what was persisted, not an in-memory value.
        let loaded = get_crt_filter_at(&paths).expect("get after set");
        assert_eq!(loaded, dto);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn set_crt_filter_clamps_out_of_range_intensities_before_persisting() {
        let (paths, tmp) = temp_paths("clamp");
        let dto = CrtFilterDto {
            scanlines: 255,
            curvature: 255,
            color_bleed: 255,
            vignette: 255,
            preset: None,
        };
        set_crt_filter_at(&paths, dto).expect("set");

        let loaded = get_crt_filter_at(&paths).expect("get");
        assert_eq!(loaded.scanlines, 100);
        assert_eq!(loaded.curvature, 100);
        assert_eq!(loaded.color_bleed, 100);
        assert_eq!(loaded.vignette, 100);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn set_crt_filter_with_a_preset_persists_and_reloads_the_preset() {
        let (paths, tmp) = temp_paths("preset");
        let dto: CrtFilterDto = CrtFilterConfig::from_preset(CrtPreset::Arcade).into();
        set_crt_filter_at(&paths, dto).expect("set");

        let loaded = get_crt_filter_at(&paths).expect("get");
        assert_eq!(loaded.preset, Some(CrtPreset::Arcade));
        assert_eq!(loaded, dto);
        std::fs::remove_dir_all(&tmp).ok();
    }
}
