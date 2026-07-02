//! Familiar Bearer-key storage in the macOS Keychain (W12,
//! architecture-design.md §4.1).
//!
//! The Bearer key is a secret and is NEVER written to disk (not to
//! `app-config.json`, not to the `settings` table). It lives in the macOS
//! Keychain via the `keyring` crate. The key store is abstracted behind the
//! [`KeyStore`] trait so the client and tests can substitute an in-memory store;
//! production uses [`KeychainStore`].
//!
//! A missing key is NOT an error — it yields `Ok(None)` so the probe degrades to
//! "present but unauthorized" (architecture-design.md §2.8).
//!
//! **Post-rename Keychain migration (W269B, v0.26,
//! app-infrastructure-design.md §Rename):** the Keychain service name moved
//! from [`LEGACY_KEYCHAIN_SERVICE`] to [`KEYCHAIN_SERVICE`]. Reads try the new
//! service first, fall back to the legacy service, and on a legacy hit
//! forward-write the value under the new service name — the legacy entry is
//! left in place (never deleted) so a downgrade still finds its key. The
//! fallback/forward-write decision is the pure, unit-tested [`resolve`]
//! function; [`KeychainStore::get`] is the only caller that performs I/O.

use crate::error::{AppError, AppResult};

/// Keychain service name under which the app stores its secrets (post-rename,
/// W269B).
pub const KEYCHAIN_SERVICE: &str = "com.retro-game-player.app";
/// Legacy (pre-rename) Keychain service name, kept as a fallback-read source
/// so an existing user's stored Familiar Bearer key is not orphaned by the
/// rename. Never written to; never deleted from.
pub const LEGACY_KEYCHAIN_SERVICE: &str = "com.harmony.app";
/// Keychain account/key name for the Familiar Bearer key.
pub const FAMILIAR_KEY_ACCOUNT: &str = "familiar-bearer-key";

/// Outcome of resolving a Keychain read across the new and legacy service
/// names (W269B migration).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeychainResolution {
    /// The value to return to the caller, if any.
    pub value: Option<String>,
    /// Whether the value must be forward-written under [`KEYCHAIN_SERVICE`]
    /// so subsequent reads hit the new service name directly.
    pub write_forward: bool,
}

/// Pure migration-decision logic for a Keychain read, given the raw values
/// already fetched from the new and legacy service entries. Contains no I/O
/// so it is unit-testable without a real Keychain.
///
/// - new present → new wins, no forward-write (already migrated / never
///   needed migrating).
/// - new absent, legacy present → legacy value returned, forward-write
///   requested (so the next read hits the new service directly). The legacy
///   entry is never deleted here — the caller decides whether/when to write,
///   and the legacy entry is left untouched either way.
/// - neither present → `None`, no forward-write.
fn resolve(new_val: Option<String>, legacy_val: Option<String>) -> KeychainResolution {
    match new_val {
        Some(v) => KeychainResolution {
            value: Some(v),
            write_forward: false,
        },
        None => match legacy_val {
            Some(v) => KeychainResolution {
                value: Some(v),
                write_forward: true,
            },
            None => KeychainResolution {
                value: None,
                write_forward: false,
            },
        },
    }
}

/// Abstraction over secret storage so the Familiar client is testable without
/// the real Keychain. Implementors store/retrieve/delete a single named secret.
pub trait KeyStore: Send + Sync {
    /// Return the stored key, or `None` if no key has been set. Absence is not an
    /// error.
    fn get(&self) -> AppResult<Option<String>>;
    /// Store (or replace) the key.
    fn set(&self, key: &str) -> AppResult<()>;
    /// Delete the key. Deleting an absent key is a no-op (Ok).
    fn delete(&self) -> AppResult<()>;
}

/// Production [`KeyStore`] backed by the macOS Keychain via the `keyring` crate.
///
/// Reads consult [`KEYCHAIN_SERVICE`] first, falling back to
/// [`LEGACY_KEYCHAIN_SERVICE`] (W269B migration); writes and deletes only ever
/// target [`KEYCHAIN_SERVICE`].
pub struct KeychainStore {
    service: String,
    legacy_service: String,
    account: String,
}

impl Default for KeychainStore {
    fn default() -> Self {
        Self {
            service: KEYCHAIN_SERVICE.to_string(),
            legacy_service: LEGACY_KEYCHAIN_SERVICE.to_string(),
            account: FAMILIAR_KEY_ACCOUNT.to_string(),
        }
    }
}

impl KeychainStore {
    /// Build a store targeting the Familiar Bearer-key entry.
    pub fn new() -> Self {
        Self::default()
    }

    fn entry_for(&self, service: &str) -> AppResult<keyring::Entry> {
        keyring::Entry::new(service, &self.account)
            .map_err(|e| AppError::Internal(format!("keychain entry: {e}")))
    }

    fn entry(&self) -> AppResult<keyring::Entry> {
        self.entry_for(&self.service)
    }

    /// Read a single service entry, mapping "no entry" to `Ok(None)`.
    fn read_service(&self, service: &str) -> AppResult<Option<String>> {
        match self.entry_for(service)?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Internal(format!("keychain get: {e}"))),
        }
    }
}

impl KeyStore for KeychainStore {
    fn get(&self) -> AppResult<Option<String>> {
        let new_val = self.read_service(&self.service)?;
        let legacy_val = if new_val.is_some() {
            // Already resolved from the new service; skip the legacy lookup.
            None
        } else {
            self.read_service(&self.legacy_service)?
        };

        let resolution = resolve(new_val, legacy_val);
        if resolution.write_forward {
            if let Some(v) = &resolution.value {
                self.set(v)?;
            }
        }
        Ok(resolution.value)
    }

    fn set(&self, key: &str) -> AppResult<()> {
        self.entry()?
            .set_password(key)
            .map_err(|e| AppError::Internal(format!("keychain set: {e}")))
    }

    fn delete(&self) -> AppResult<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Internal(format!("keychain delete: {e}"))),
        }
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! In-memory [`KeyStore`] for tests — no real Keychain access.
    use super::*;
    use std::sync::Mutex;

    /// A `KeyStore` holding the secret in process memory.
    #[derive(Default)]
    pub struct MemoryKeyStore {
        value: Mutex<Option<String>>,
    }

    impl MemoryKeyStore {
        /// Pre-seed the store with a key.
        pub fn with_key(key: &str) -> Self {
            Self {
                value: Mutex::new(Some(key.to_string())),
            }
        }
    }

    impl KeyStore for MemoryKeyStore {
        fn get(&self) -> AppResult<Option<String>> {
            Ok(self.value.lock().unwrap().clone())
        }
        fn set(&self, key: &str) -> AppResult<()> {
            *self.value.lock().unwrap() = Some(key.to_string());
            Ok(())
        }
        fn delete(&self) -> AppResult<()> {
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::MemoryKeyStore;
    use super::*;

    #[test]
    fn memory_store_roundtrips() {
        let s = MemoryKeyStore::default();
        assert_eq!(s.get().unwrap(), None);
        s.set("secret").unwrap();
        assert_eq!(s.get().unwrap().as_deref(), Some("secret"));
        s.delete().unwrap();
        assert_eq!(s.get().unwrap(), None);
    }

    #[test]
    fn delete_absent_is_ok() {
        let s = MemoryKeyStore::default();
        assert!(s.delete().is_ok());
    }

    /// Data-driven cases for the pure W269B migration decision: (new, legacy)
    /// -> expected `KeychainResolution`.
    #[test]
    fn resolve_migration_cases() {
        let cases: &[(Option<&str>, Option<&str>, KeychainResolution)] = &[
            // new-hit: new wins verbatim, no forward-write needed.
            (
                Some("new-secret"),
                None,
                KeychainResolution {
                    value: Some("new-secret".to_string()),
                    write_forward: false,
                },
            ),
            // legacy-only: legacy value returned, forward-write requested.
            (
                None,
                Some("legacy-secret"),
                KeychainResolution {
                    value: Some("legacy-secret".to_string()),
                    write_forward: true,
                },
            ),
            // neither present: None, no forward-write.
            (
                None,
                None,
                KeychainResolution {
                    value: None,
                    write_forward: false,
                },
            ),
            // both present: new wins, legacy is ignored, no forward-write.
            (
                Some("new-secret"),
                Some("legacy-secret"),
                KeychainResolution {
                    value: Some("new-secret".to_string()),
                    write_forward: false,
                },
            ),
        ];

        for (new_val, legacy_val, expected) in cases {
            let actual = resolve(
                new_val.map(|s| s.to_string()),
                legacy_val.map(|s| s.to_string()),
            );
            assert_eq!(
                actual, *expected,
                "resolve({new_val:?}, {legacy_val:?}) mismatch"
            );
        }
    }
}
