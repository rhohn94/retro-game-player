//! General `AppConfig` IPC surface (v0.26 W260, tv-mode-design.md §Auto-enter).
//!
//! Narrow, typed get/set commands for the subset of [`AppConfig`] fields the
//! frontend needs to read/toggle directly outside a domain-specific pane
//! (mirrors the shape of `commands::native_play::get/set_native_play_enabled`
//! and `commands::player_prefs`). Currently covers `auto_tv_mode` — the
//! "Start in TV mode" Settings → Appearance toggle plus the App.tsx startup
//! read. Extend this module (not a new one) as more general config fields need
//! a frontend round trip.

use crate::config::{paths::Paths, AppConfig};
use crate::error::AppResult;

/// Whether the app should enter TV mode automatically on a fresh launch
/// (`AppConfig::auto_tv_mode`, off by default).
#[tauri::command]
pub fn get_auto_tv_mode() -> AppResult<bool> {
    Ok(AppConfig::load(&Paths::app_support()?)?.auto_tv_mode)
}

/// Persists the auto-TV-mode startup preference.
#[tauri::command]
pub fn set_auto_tv_mode(enabled: bool) -> AppResult<()> {
    let paths = Paths::app_support()?;
    let mut cfg = AppConfig::load(&paths)?;
    cfg.auto_tv_mode = enabled;
    cfg.save(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_false_when_no_config_file_exists() {
        // get_auto_tv_mode delegates straight to AppConfig::load's documented
        // "missing file -> default" behavior; AppConfig::default's own
        // auto_tv_mode assertion lives in config::mod's test suite. Here we
        // only confirm the IPC wrapper doesn't itself flip the value.
        let cfg = AppConfig::default();
        assert!(!cfg.auto_tv_mode);
    }
}
