//! RetroAchievements account settings IPC (v0.37 W371,
//! retroachievements-design.md §Client + accounts). Mirrors the shape of
//! `commands::familiar`: the username is a plain `AppConfig` field, the Web
//! API key lives only in the macOS Keychain (`KeyStore` trait via
//! `KeychainStore::for_account`), and validation is a thin adapter over
//! [`RetroAchievementsClient::validate_credential`].
//!
//! **No credential ⇒ zero network calls.** `validate_retroachievements_account`
//! short-circuits to an inert status the moment either the username or the
//! key is absent — it never constructs an HTTP client in that case, matching
//! the "optional account" contract the whole v0.37 achievements feature
//! depends on.

use crate::config::{paths::Paths, AppConfig};
use crate::core::familiar::keychain::{KeyStore, KeychainStore};
use crate::core::retroachievements::client::RetroAchievementsClient;
use crate::core::retroachievements::RA_KEY_ACCOUNT;
use crate::error::{AppError, AppResult};
use serde::Serialize;

/// Build the Keychain-backed store for the RA Web API key.
fn keystore() -> KeychainStore {
    KeychainStore::for_account(RA_KEY_ACCOUNT)
}

/// Status of the configured RetroAchievements account, as read by the
/// Settings pane. Never includes the key itself (write-only from the UI's
/// perspective, matching the Familiar Bearer-key contract).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetroAchievementsAccountStatus {
    /// The persisted username, or `None` if never configured.
    pub username: Option<String>,
    /// Whether a Web API key is currently stored in the Keychain.
    pub has_key: bool,
}

/// Outcome of validating the configured account against the real API.
/// Distinct from `core::retroachievements::client::RaLoginResult` at the IPC
/// boundary so an incomplete (no-credential) configuration has its own
/// explicit variant rather than overloading `valid: false`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum RetroAchievementsValidation {
    /// No username and/or no key configured — validation never attempted,
    /// no network call made.
    NotConfigured,
    /// RA accepted the credential.
    Valid,
    /// RA rejected the credential; `message` is RA's own error text when
    /// supplied.
    Invalid { message: Option<String> },
}

/// Read the current account status (username + whether a key is stored).
/// Pure config/Keychain reads — never touches the network.
#[tauri::command]
pub async fn get_retroachievements_account() -> AppResult<RetroAchievementsAccountStatus> {
    tauri::async_runtime::spawn_blocking(|| {
        let paths = Paths::app_support()?;
        let config = AppConfig::load(&paths)?;
        let has_key = keystore().get()?.is_some();
        Ok(RetroAchievementsAccountStatus {
            username: config.retroachievements_username,
            has_key,
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("get_retroachievements_account task join: {e}")))?
}

/// Persist the RetroAchievements account settings from the Settings screen.
/// The username goes to the file-backed `AppConfig`; the Web API key goes to
/// the Keychain (never written to disk). `None` for either leaves the
/// stored value unchanged; an explicit empty string clears the key.
#[tauri::command]
pub async fn save_retroachievements_account(
    username: Option<String>,
    api_key: Option<String>,
) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        let paths = Paths::app_support()?;
        let mut config = AppConfig::load(&paths)?;
        if let Some(name) = username {
            let trimmed = name.trim();
            config.retroachievements_username = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            };
        }
        config.save(&paths)?;

        if let Some(key) = api_key {
            let store = keystore();
            if key.is_empty() {
                store.delete()?;
            } else {
                store.set(&key)?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("save_retroachievements_account task join: {e}")))?
}

/// Validate the configured username + Web API key against the real
/// RetroAchievements API. **Zero network calls when either half of the
/// credential is absent** — returns `NotConfigured` immediately in that
/// case, before any `RetroAchievementsClient` is even constructed.
#[tauri::command]
pub async fn validate_retroachievements_account() -> AppResult<RetroAchievementsValidation> {
    tauri::async_runtime::spawn_blocking(|| -> AppResult<RetroAchievementsValidation> {
        let paths = Paths::app_support()?;
        let config = AppConfig::load(&paths)?;
        let Some(username) = config
            .retroachievements_username
            .filter(|u| !u.trim().is_empty())
        else {
            return Ok(RetroAchievementsValidation::NotConfigured);
        };
        let Some(api_key) = keystore().get()? else {
            return Ok(RetroAchievementsValidation::NotConfigured);
        };

        let client = RetroAchievementsClient::new(username, api_key);
        let result = client.validate_credential()?;
        Ok(if result.valid {
            RetroAchievementsValidation::Valid
        } else {
            RetroAchievementsValidation::Invalid {
                message: result.message,
            }
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("validate_retroachievements_account task join: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::familiar::keychain::test_support::MemoryKeyStore;

    // These mirror `commands::steamgriddb`'s test-doubling approach: the
    // real `#[tauri::command]` fns resolve `Paths::app_support()` /
    // `KeychainStore` internally, so these helpers reproduce their exact
    // bodies against an isolated `Paths::with_root` + an in-memory
    // `KeyStore`, proving the logic (including the "no credential ⇒ no
    // network call" branch) without a real Keychain or network.

    fn temp_paths(tag: &str) -> (Paths, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!(
            "rgp-retroachievements-cmd-{tag}-{}",
            std::process::id()
        ));
        let p = Paths::with_root(tmp.join(crate::config::paths::BUNDLE_ID)).expect("root");
        (p, tmp)
    }

    fn account_status_at(
        paths: &Paths,
        store: &dyn KeyStore,
    ) -> AppResult<RetroAchievementsAccountStatus> {
        let config = AppConfig::load(paths)?;
        let has_key = store.get()?.is_some();
        Ok(RetroAchievementsAccountStatus {
            username: config.retroachievements_username,
            has_key,
        })
    }

    fn save_account_at(
        paths: &Paths,
        store: &dyn KeyStore,
        username: Option<String>,
        api_key: Option<String>,
    ) -> AppResult<()> {
        let mut config = AppConfig::load(paths)?;
        if let Some(name) = username {
            let trimmed = name.trim();
            config.retroachievements_username = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            };
        }
        config.save(paths)?;

        if let Some(key) = api_key {
            if key.is_empty() {
                store.delete()?;
            } else {
                store.set(&key)?;
            }
        }
        Ok(())
    }

    /// Reproduces `validate_retroachievements_account`'s short-circuit
    /// exactly, but with an injected "network attempted" flag instead of a
    /// real client — proving the no-credential path never reaches the point
    /// where a client would be constructed.
    fn validate_at(
        paths: &Paths,
        store: &dyn KeyStore,
        network_attempted: &std::cell::Cell<bool>,
    ) -> AppResult<RetroAchievementsValidation> {
        let config = AppConfig::load(paths)?;
        let Some(username) = config
            .retroachievements_username
            .filter(|u| !u.trim().is_empty())
        else {
            return Ok(RetroAchievementsValidation::NotConfigured);
        };
        let Some(_api_key) = store.get()? else {
            return Ok(RetroAchievementsValidation::NotConfigured);
        };
        network_attempted.set(true);
        let _ = username;
        // A real client would be constructed + called here; this test double
        // stops short since it only needs to prove the short-circuit.
        Ok(RetroAchievementsValidation::Valid)
    }

    #[test]
    fn validation_variants_serialize_to_the_documented_camel_case_shape() {
        // Locks in the wire shape `src/ipc/retroachievements.ts`'s
        // `RetroAchievementsValidation` union depends on.
        assert_eq!(
            serde_json::to_string(&RetroAchievementsValidation::NotConfigured).unwrap(),
            r#"{"status":"notConfigured"}"#
        );
        assert_eq!(
            serde_json::to_string(&RetroAchievementsValidation::Valid).unwrap(),
            r#"{"status":"valid"}"#
        );
        assert_eq!(
            serde_json::to_string(&RetroAchievementsValidation::Invalid {
                message: Some("Invalid API Key".to_string())
            })
            .unwrap(),
            r#"{"status":"invalid","message":"Invalid API Key"}"#
        );
    }

    #[test]
    fn account_status_serializes_to_camel_case() {
        let status = RetroAchievementsAccountStatus {
            username: Some("RaUser".to_string()),
            has_key: true,
        };
        assert_eq!(
            serde_json::to_string(&status).unwrap(),
            r#"{"username":"RaUser","hasKey":true}"#
        );
    }

    #[test]
    fn get_on_a_fresh_install_reports_not_configured() {
        let (paths, tmp) = temp_paths("fresh");
        let store = MemoryKeyStore::default();
        let status = account_status_at(&paths, &store).expect("status");
        assert_eq!(
            status,
            RetroAchievementsAccountStatus {
                username: None,
                has_key: false,
            }
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_then_get_round_trips_username_and_key_presence() {
        let (paths, tmp) = temp_paths("round-trip");
        let store = MemoryKeyStore::default();
        save_account_at(
            &paths,
            &store,
            Some("RaUser".to_string()),
            Some("ra-key-123".to_string()),
        )
        .expect("save");

        let status = account_status_at(&paths, &store).expect("status");
        assert_eq!(
            status,
            RetroAchievementsAccountStatus {
                username: Some("RaUser".to_string()),
                has_key: true,
            }
        );
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_blank_username_clears_it() {
        let (paths, tmp) = temp_paths("blank-username");
        let store = MemoryKeyStore::default();
        save_account_at(&paths, &store, Some("RaUser".to_string()), None).expect("save real");
        save_account_at(&paths, &store, Some("   ".to_string()), None).expect("save blank");

        let status = account_status_at(&paths, &store).expect("status");
        assert_eq!(status.username, None);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn save_empty_key_clears_it() {
        let (paths, tmp) = temp_paths("clear-key");
        let store = MemoryKeyStore::default();
        save_account_at(&paths, &store, None, Some("real-key".to_string())).expect("save key");
        save_account_at(&paths, &store, None, Some(String::new())).expect("clear key");

        let status = account_status_at(&paths, &store).expect("status");
        assert!(!status.has_key);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_with_no_username_never_attempts_network() {
        let (paths, tmp) = temp_paths("validate-no-username");
        let store = MemoryKeyStore::with_key("some-key");
        let attempted = std::cell::Cell::new(false);

        let result = validate_at(&paths, &store, &attempted).expect("validate");
        assert_eq!(result, RetroAchievementsValidation::NotConfigured);
        assert!(!attempted.get(), "no network call should have been attempted");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_with_no_key_never_attempts_network() {
        let (paths, tmp) = temp_paths("validate-no-key");
        let store = MemoryKeyStore::default();
        save_account_at(&paths, &store, Some("RaUser".to_string()), None).expect("save username");
        let attempted = std::cell::Cell::new(false);

        let result = validate_at(&paths, &store, &attempted).expect("validate");
        assert_eq!(result, RetroAchievementsValidation::NotConfigured);
        assert!(!attempted.get(), "no network call should have been attempted");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn validate_with_full_credential_attempts_network() {
        let (paths, tmp) = temp_paths("validate-full");
        let store = MemoryKeyStore::default();
        save_account_at(
            &paths,
            &store,
            Some("RaUser".to_string()),
            Some("ra-key".to_string()),
        )
        .expect("save");
        let attempted = std::cell::Cell::new(false);

        let result = validate_at(&paths, &store, &attempted).expect("validate");
        assert_eq!(result, RetroAchievementsValidation::Valid);
        assert!(attempted.get(), "a network call should have been attempted");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
