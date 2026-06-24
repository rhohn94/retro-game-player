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

use crate::error::{AppError, AppResult};

/// Keychain service name under which Harmony stores its secrets.
pub const KEYCHAIN_SERVICE: &str = "com.harmony.app";
/// Keychain account/key name for the Familiar Bearer key.
pub const FAMILIAR_KEY_ACCOUNT: &str = "familiar-bearer-key";

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
pub struct KeychainStore {
    service: String,
    account: String,
}

impl Default for KeychainStore {
    fn default() -> Self {
        Self {
            service: KEYCHAIN_SERVICE.to_string(),
            account: FAMILIAR_KEY_ACCOUNT.to_string(),
        }
    }
}

impl KeychainStore {
    /// Build a store targeting the Harmony Familiar Bearer-key entry.
    pub fn new() -> Self {
        Self::default()
    }

    fn entry(&self) -> AppResult<keyring::Entry> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| AppError::Internal(format!("keychain entry: {e}")))
    }
}

impl KeyStore for KeychainStore {
    fn get(&self) -> AppResult<Option<String>> {
        match self.entry()?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Internal(format!("keychain get: {e}"))),
        }
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
}
