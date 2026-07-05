//! SteamGridDB API key settings IPC (v0.32 W321,
//! non-retro-library-design.md §SteamGridDB art). Mirrors the shape and
//! conventions of `commands::crt_filter` — a single value persisted in
//! [`AppConfig`], read/written by a thin `#[tauri::command]` pair with no
//! `tauri::State` argument.
//!
//! Setting an empty/whitespace-only key persists `None` rather than the
//! empty string, so `core::metadata::art_fallback_chain`'s "no key ⇒ inert"
//! check (which also treats blank as absent) stays in agreement with what's
//! actually on disk.

use crate::config::{paths::Paths, AppConfig};
use crate::error::AppResult;

/// The persisted SteamGridDB API key, or `None` if the user hasn't
/// configured one — the SteamGridDB art-fallback rung is fully inert in
/// that case.
#[tauri::command]
pub fn get_steamgriddb_api_key() -> AppResult<Option<String>> {
    let cfg = AppConfig::load(&Paths::app_support()?)?;
    Ok(cfg.steamgriddb_api_key)
}

/// Persists the SteamGridDB API key. A blank/whitespace-only value clears
/// the setting (persists `None`) rather than storing an unusable empty
/// string — the same "blank means absent" contract
/// `core::metadata::steamgriddb_art::fetch_steamgriddb_art` applies at fetch
/// time.
#[tauri::command]
pub fn set_steamgriddb_api_key(key: Option<String>) -> AppResult<()> {
    let paths = Paths::app_support()?;
    let mut cfg = AppConfig::load(&paths)?;
    cfg.steamgriddb_api_key = key.filter(|k| !k.trim().is_empty());
    cfg.save(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mirrors `commands::crt_filter`'s test-doubling approach: these commands
    // resolve `Paths::app_support()` internally (no `tauri::State`), so the
    // real `#[tauri::command]` fns can't be pointed at an isolated on-disk
    // root from a test. These helpers mirror the commands' exact bodies
    // against an isolated `Paths::with_root`, proving the full persisted
    // round trip rather than just in-memory field access.

    fn temp_paths(tag: &str) -> (Paths, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!(
            "rgp-steamgriddb-cmd-{tag}-{}",
            std::process::id()
        ));
        let p = Paths::with_root(tmp.join(crate::config::paths::BUNDLE_ID)).expect("root");
        (p, tmp)
    }

    fn get_steamgriddb_api_key_at(paths: &Paths) -> AppResult<Option<String>> {
        let cfg = AppConfig::load(paths)?;
        Ok(cfg.steamgriddb_api_key)
    }

    fn set_steamgriddb_api_key_at(paths: &Paths, key: Option<String>) -> AppResult<()> {
        let mut cfg = AppConfig::load(paths)?;
        cfg.steamgriddb_api_key = key.filter(|k| !k.trim().is_empty());
        cfg.save(paths)
    }

    #[test]
    fn get_on_a_fresh_install_returns_none() {
        let (paths, tmp) = temp_paths("fresh");
        let key = get_steamgriddb_api_key_at(&paths).expect("get");
        assert_eq!(key, None);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn set_then_get_round_trips_a_real_persisted_key() {
        let (paths, tmp) = temp_paths("round-trip");
        set_steamgriddb_api_key_at(&paths, Some("sgdb-abc123".to_string())).expect("set");

        let loaded = get_steamgriddb_api_key_at(&paths).expect("get after set");
        assert_eq!(loaded.as_deref(), Some("sgdb-abc123"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn set_blank_key_clears_it_to_none() {
        let (paths, tmp) = temp_paths("blank");
        set_steamgriddb_api_key_at(&paths, Some("real-key".to_string())).expect("set real");
        set_steamgriddb_api_key_at(&paths, Some("   ".to_string())).expect("set blank");

        let loaded = get_steamgriddb_api_key_at(&paths).expect("get");
        assert_eq!(loaded, None);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn set_none_clears_an_existing_key() {
        let (paths, tmp) = temp_paths("none");
        set_steamgriddb_api_key_at(&paths, Some("real-key".to_string())).expect("set real");
        set_steamgriddb_api_key_at(&paths, None).expect("clear");

        let loaded = get_steamgriddb_api_key_at(&paths).expect("get");
        assert_eq!(loaded, None);
        std::fs::remove_dir_all(&tmp).ok();
    }
}
