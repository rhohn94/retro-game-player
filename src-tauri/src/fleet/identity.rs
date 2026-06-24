//! Ensign identity — the stable `harmony-{env}-{ordinal}` instance id.
//!
//! The id must survive restarts, so it is persisted as `fleet-identity.json`
//! under the app-support `config/` dir (resolved by `config::paths::Paths`,
//! never hard-coded — architecture-design.md §4.1). On first run we mint a fresh
//! identity (default env, ordinal 0) and write it; subsequent runs load the same
//! file and return the identical id. This OWNS the identity the telemetry
//! placeholder (`harmony-local-0`) stood in for (W4).

use crate::error::AppResult;
use crate::config::paths::Paths;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Persisted identity filename under `config/`.
pub const IDENTITY_FILE_NAME: &str = "fleet-identity.json";

/// Default deployment environment when none is configured. Matches the W4
/// telemetry placeholder's `local` segment for continuity.
pub const DEFAULT_ENV: &str = "local";

/// Default ordinal for a single-instance local deployment.
pub const DEFAULT_ORDINAL: u32 = 0;

/// Instance-id prefix (the product segment). No magic strings at call sites.
pub const INSTANCE_ID_PREFIX: &str = "harmony";

/// The stable Ensign identity. Persisted as `fleet-identity.json`; loaded
/// verbatim on later runs so the id is constant across restarts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Identity {
    /// Deployment environment segment (e.g. `local`, `prod`).
    pub env: String,
    /// Ordinal segment (distinguishes instances within an env).
    pub ordinal: u32,
}

impl Identity {
    /// A fresh default identity (`local`, ordinal 0).
    pub fn default_identity() -> Self {
        Self {
            env: DEFAULT_ENV.to_string(),
            ordinal: DEFAULT_ORDINAL,
        }
    }

    /// Render the stable instance id `harmony-{env}-{ordinal}`.
    pub fn instance_id(&self) -> String {
        format!("{}-{}-{}", INSTANCE_ID_PREFIX, self.env, self.ordinal)
    }

    /// The on-disk identity file path (`config/fleet-identity.json`).
    pub fn file_path(paths: &Paths) -> AppResult<PathBuf> {
        Ok(paths.config_dir()?.join(IDENTITY_FILE_NAME))
    }

    /// Load the persisted identity, or mint + persist a fresh default on first
    /// run. Idempotent: repeated calls return the same id for the life of the
    /// file. A corrupt file is treated as absent and replaced (best-effort).
    pub fn load_or_init(paths: &Paths) -> AppResult<Self> {
        let file = Self::file_path(paths)?;
        if let Ok(bytes) = std::fs::read(&file) {
            if let Ok(identity) = serde_json::from_slice::<Identity>(&bytes) {
                return Ok(identity);
            }
        }
        let identity = Self::default_identity();
        identity.save(paths)?;
        Ok(identity)
    }

    /// Persist this identity to `config/fleet-identity.json`.
    pub fn save(&self, paths: &Paths) -> AppResult<()> {
        let file = Self::file_path(paths)?;
        let json = serde_json::to_vec_pretty(self)?;
        std::fs::write(&file, json)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::paths::BUNDLE_ID;

    fn temp_paths(tag: &str) -> (Paths, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!(
            "harmony-ident-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        (Paths::with_root(tmp.join(BUNDLE_ID)).expect("root"), tmp)
    }

    #[test]
    fn instance_id_format() {
        let id = Identity {
            env: "prod".into(),
            ordinal: 7,
        };
        assert_eq!(id.instance_id(), "harmony-prod-7");
    }

    #[test]
    fn default_matches_w4_placeholder_form() {
        // The W4 telemetry placeholder was `harmony-local-0`; the default
        // identity reproduces that exact shape for continuity.
        assert_eq!(Identity::default_identity().instance_id(), "harmony-local-0");
    }

    #[test]
    fn load_or_init_persists_and_is_stable_across_restarts() {
        let (paths, tmp) = temp_paths("stable");

        // First run mints + persists.
        let first = Identity::load_or_init(&paths).expect("init");
        assert!(Identity::file_path(&paths).unwrap().exists());

        // Simulate a restart: a fresh load returns the identical id.
        let second = Identity::load_or_init(&paths).expect("reload");
        assert_eq!(first, second);
        assert_eq!(first.instance_id(), second.instance_id());

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn corrupt_file_is_replaced() {
        let (paths, tmp) = temp_paths("corrupt");
        let file = Identity::file_path(&paths).unwrap();
        std::fs::write(&file, b"{ not valid json").unwrap();

        let id = Identity::load_or_init(&paths).expect("recover");
        assert_eq!(id, Identity::default_identity());
        // The replacement was written back as valid JSON.
        let back: Identity =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).expect("reparse");
        assert_eq!(back, id);

        std::fs::remove_dir_all(&tmp).ok();
    }
}
