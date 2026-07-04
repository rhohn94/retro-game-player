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
}
