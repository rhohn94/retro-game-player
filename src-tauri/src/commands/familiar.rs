//! Familiar domain IPC adapters (W12, architecture-design.md §2.8).
//!
//! Thin `#[tauri::command]` wrappers over [`core::familiar`]. They build a
//! [`FamiliarClient`] from the file-backed base URL (`AppConfig`, W4) plus the
//! production transport and Keychain key store, then delegate. Both commands
//! degrade silently: `probe_familiar` always returns a `FamiliarProbe` describing
//! present/authorized so the UI shows or hides AI affordances; `enrich_game`
//! falls back to the un-enriched game when the Familiar is absent.
//!
//! Blocking work (HTTP, Keychain) runs on Tauri's blocking pool so the async
//! command never stalls the runtime.

use crate::config::{paths::Paths, AppConfig};
use crate::core::familiar::client::FamiliarClient;
use crate::core::familiar::keychain::{KeyStore, KeychainStore};
use crate::core::familiar::probe::FamiliarProbe;
use crate::core::familiar::transport::ReqwestTransport;
use crate::db::repo::library::{Game, LibraryRepo};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use tauri::State;

/// Build a production [`FamiliarClient`] from the on-disk config base URL plus the
/// real transport + Keychain store. Isolated so both commands construct it
/// identically (no duplication).
fn build_client() -> AppResult<FamiliarClient> {
    let paths = Paths::app_support()?;
    let config = AppConfig::load(&paths)?;
    Ok(FamiliarClient::new(
        Box::new(ReqwestTransport::new()),
        Box::new(KeychainStore::new()),
        config.familiar_base_url,
    ))
}

/// Persist the Familiar connection settings from the Settings screen (W15):
/// the base URL goes to the file-backed [`AppConfig`] (W4); the Bearer key goes
/// to the macOS Keychain (W12 contract — never written to disk). `None`/empty
/// `api_key` leaves the stored key untouched; an explicit empty string clears it.
/// Runs on the blocking pool (file IO + Keychain).
#[tauri::command]
pub async fn save_familiar_config(
    base_url: Option<String>,
    api_key: Option<String>,
) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        let paths = Paths::app_support()?;
        let mut config = AppConfig::load(&paths)?;
        if let Some(url) = base_url {
            let trimmed = url.trim();
            if !trimmed.is_empty() {
                config.familiar_base_url = trimmed.to_string();
            }
        }
        config.save(&paths)?;

        if let Some(key) = api_key {
            let store = KeychainStore::new();
            if key.is_empty() {
                store.delete()?;
            } else {
                store.set(&key)?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("save_familiar_config task join: {e}")))?
}

/// Two-stage probe of the optional Familiar service. Returns a `FamiliarProbe`
/// (present / authorized / capabilities) the UI uses to show or hide AI
/// affordances. Never errors on an absent/unauthorized/slow Familiar — those are
/// reported as `present:false`/`authorized:false`.
#[tauri::command]
pub async fn probe_familiar() -> AppResult<FamiliarProbe> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = build_client()?;
        Ok(client.probe())
    })
    .await
    .map_err(|e| AppError::Internal(format!("probe task join: {e}")))?
}

/// Enrich a game's metadata via the Familiar (fuzzy-title / ambiguous-dump
/// disambiguation). On success the game's `clean_name` is updated and persisted;
/// when the Familiar is absent/unauthorized/rate-limited/slow the original game is
/// returned unchanged (silent degrade).
#[tauri::command]
pub async fn enrich_game(db: State<'_, Db>, game_id: i64) -> AppResult<Game> {
    // Snapshot the current game on the calling task (cheap DB read).
    let repo = LibraryRepo::new(&db);
    let game = repo.get_game(game_id)?;

    // The network/Keychain enrichment runs on the blocking pool.
    let clean_name = game.clean_name.clone();
    let enrichment = tauri::async_runtime::spawn_blocking(move || {
        let client = build_client()?;
        Ok::<_, AppError>(client.enrich(game_id, &clean_name))
    })
    .await
    .map_err(|e| AppError::Internal(format!("enrich task join: {e}")))??;

    match enrichment {
        Some(e) if e.clean_name != game.clean_name => {
            repo.set_game_clean_name(game_id, &e.clean_name)?;
            repo.get_game(game_id)
        }
        // Absent / unauthorized / no change → return the game as-is.
        _ => Ok(game),
    }
}
