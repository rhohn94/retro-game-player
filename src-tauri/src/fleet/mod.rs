//! Fleet / Ensign domain (W11). Implements the Fleet Status Contract v1:
//! a stable Ensign identity, the deployed `fleet-instance.json` manifest, the
//! `current` symlink, and a localhost-only HTTP status server — plus a shared
//! [`Ensign`] the IPC command (`get_fleet_status`) reads. Master contract:
//! architecture-design.md §2.7, §4.2; feature doc: fleet-ensign-design.md.
//!
//! One file per concern: [`identity`] (stable id), [`schemas`] (wire types),
//! [`manifest`] (status/manifest assembly + write), [`server`] (HTTP face).

pub mod identity;
pub mod manifest;
pub mod schemas;
pub mod server;

use crate::config::paths::Paths;
use crate::error::AppResult;
use server::{spawn_status_server, Ensign, FLEET_STATUS_PORT};

/// Bring the Ensign online for this run: resolve (or mint) the stable identity,
/// write `fleet-instance.json` + the `current` symlink to the deployed root,
/// then bind the localhost status server. Returns the shared [`Ensign`] so the
/// caller can hand it to Tauri state for `get_fleet_status`.
///
/// `version` is the app version (`CARGO_PKG_VERSION`); `version_dir` is the
/// deployed version directory name (e.g. `"v0.1.0"`) the manifest is written
/// under. A status-server bind failure is non-fatal — it is returned to the
/// caller to log, while the Ensign (and the IPC command) still function.
pub fn start(paths: &Paths, version: &str, version_dir: &str) -> AppResult<Ensign> {
    let identity = identity::Identity::load_or_init(paths)?;

    // Assemble + persist the at-rest manifest (mirrors the deployed layout).
    let resolver = manifest::FsDependencyResolver::new(paths);
    let edges = manifest::build_dependency_edges(&resolver);
    let manifest = manifest::build_manifest(&identity, version, FLEET_STATUS_PORT, edges);
    manifest::write_manifest(paths, &manifest, version_dir)?;

    let ensign = Ensign::new(identity, version, paths.clone());
    // Best-effort: a busy port must not abort setup.
    if let Err(e) = spawn_status_server(ensign.clone()) {
        eprintln!("[fleet] status server not bound: {e}");
    }
    Ok(ensign)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::paths::BUNDLE_ID;

    #[test]
    fn start_writes_manifest_and_returns_ensign() {
        let tmp = std::env::temp_dir().join(format!(
            "harmony-fleetstart-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let paths = Paths::with_root(tmp.join(BUNDLE_ID)).expect("root");

        let ensign = start(&paths, "0.1.0", "v0.1.0").expect("start");
        assert_eq!(ensign.instance_id(), "harmony-local-0");

        let manifest_file = paths
            .deployed_version_dir("v0.1.0")
            .unwrap()
            .join(manifest::FLEET_INSTANCE_FILE_NAME);
        assert!(manifest_file.exists());

        std::fs::remove_dir_all(&tmp).ok();
    }
}
