//! App configuration: the typed [`AppConfig`] model plus load/save against
//! `config/app-config.json` (§4.1). Distinct from the per-key `settings` DB
//! table (§3) — `AppConfig` holds bootstrap-time, file-backed settings the app
//! needs before/around the DB (RetroArch path, Familiar base URL). The
//! canonical location is resolved by [`paths::Paths`]; nothing hard-codes it.
//!
//! Open question OQ-1 (architecture-design.md): typed-vs-`JsonValue` settings —
//! `AppConfig` deliberately uses named typed fields with defaults; the dynamic
//! `settings` table covers the open-ended case.

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
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            retroarch_path: None,
            familiar_base_url: DEFAULT_FAMILIAR_BASE_URL.to_string(),
            launch_fullscreen: true,
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
        let tmp = std::env::temp_dir().join(format!("harmony-config-{tag}-{}", std::process::id()));
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
