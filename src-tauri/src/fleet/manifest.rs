//! Manifest + status assembly for the Ensign.
//!
//! This module is the pure, testable heart of the fleet domain: it builds the
//! declared dependency edges, assembles the live [`FleetStatus`] payload (the
//! same shape `get_fleet_status` and `GET /fleet/v1/status` return), writes
//! `fleet-instance.json` to the deployed version dir, and mirrors the deployed
//! layout (`versions/{vX.Y.Z}/` + the `current` symlink) — all through
//! `config::paths::Paths` (§4.2), never a hard-coded path.

use crate::config::paths::Paths;
use crate::error::AppResult;
use crate::fleet::identity::Identity;
use crate::fleet::schemas::{
    DependencyEdge, FleetManifest, FleetStatus, FLEET_SCHEMA_VERSION,
};
use std::path::{Path, PathBuf};

/// `fleet-instance.json` filename in the deployed version dir (§4.2).
pub const FLEET_INSTANCE_FILE_NAME: &str = "fleet-instance.json";

/// Dependency-edge name for the RetroArch frontend.
pub const DEP_RETROARCH: &str = "retroarch";

/// The libretro systems Harmony v0.1 declares cores for (§3 — `'nes' | 'snes' |
/// 'n64'`). Each becomes a `core:<system>` dependency edge.
pub const DECLARED_CORE_SYSTEMS: [&str; 3] = ["nes", "snes", "n64"];

/// Resolves dependency presence. Abstracted behind a trait so the status
/// assembly is unit-testable without touching the real filesystem and so W5/W7
/// can later supply a richer resolver. The default impl checks the app-support
/// cores dir + a RetroArch presence probe.
pub trait DependencyResolver {
    /// Whether RetroArch is present/resolvable.
    fn retroarch_present(&self) -> bool;
    /// Whether an installed core dylib exists for `system`.
    fn core_present(&self, system: &str) -> bool;
}

/// Filesystem-backed resolver: RetroArch via the standard macOS app path, cores
/// via the presence of any `*_libretro.dylib` under `cores/<system>/`.
pub struct FsDependencyResolver<'a> {
    paths: &'a Paths,
}

impl<'a> FsDependencyResolver<'a> {
    /// Construct over a [`Paths`] resolver.
    pub fn new(paths: &'a Paths) -> Self {
        Self { paths }
    }
}

/// Standard macOS install location for the RetroArch app bundle.
const RETROARCH_APP_PATH: &str = "/Applications/RetroArch.app";

impl DependencyResolver for FsDependencyResolver<'_> {
    fn retroarch_present(&self) -> bool {
        Path::new(RETROARCH_APP_PATH).exists()
    }

    fn core_present(&self, system: &str) -> bool {
        let dir = match self.paths.cores_dir() {
            Ok(d) => d.join(system),
            Err(_) => return false,
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return false;
        };
        entries.flatten().any(|e| {
            e.file_name()
                .to_string_lossy()
                .ends_with("_libretro.dylib")
        })
    }
}

/// Assemble the declared dependency edges (RetroArch + one per declared core
/// system) using `resolver` to determine presence.
pub fn build_dependency_edges<R: DependencyResolver>(resolver: &R) -> Vec<DependencyEdge> {
    let mut edges = Vec::with_capacity(1 + DECLARED_CORE_SYSTEMS.len());
    edges.push(DependencyEdge::new(
        DEP_RETROARCH,
        resolver.retroarch_present(),
    ));
    for system in DECLARED_CORE_SYSTEMS {
        edges.push(DependencyEdge::new(
            format!("core:{system}"),
            resolver.core_present(system),
        ));
    }
    edges
}

/// Build the live [`FleetStatus`] payload from identity, version, uptime, and
/// resolved dependency edges. Pure — the single builder both the IPC command
/// and the HTTP handler call, so they can never drift.
pub fn build_status(
    identity: &Identity,
    version: &str,
    uptime_seconds: u64,
    dependencies: Vec<DependencyEdge>,
) -> FleetStatus {
    let status = FleetStatus::health_from(&dependencies);
    FleetStatus {
        schema_version: FLEET_SCHEMA_VERSION,
        instance_id: identity.instance_id(),
        version: version.to_string(),
        status,
        uptime_seconds,
        dependencies,
    }
}

/// Build the at-rest [`FleetManifest`] for `fleet-instance.json`.
pub fn build_manifest(
    identity: &Identity,
    version: &str,
    status_port: u16,
    dependencies: Vec<DependencyEdge>,
) -> FleetManifest {
    FleetManifest {
        schema_version: FLEET_SCHEMA_VERSION,
        instance_id: identity.instance_id(),
        env: identity.env.clone(),
        ordinal: identity.ordinal,
        version: version.to_string(),
        status_port,
        dependencies,
    }
}

/// Write `fleet-instance.json` into the deployed version dir for `version`
/// (`deployed-apps/harmony/versions/{version}/fleet-instance.json`) and ensure
/// the `current` symlink points at that version dir. Returns the manifest path.
pub fn write_manifest(
    paths: &Paths,
    manifest: &FleetManifest,
    version: &str,
) -> AppResult<PathBuf> {
    let dir = paths.deployed_version_dir(version)?;
    let file = dir.join(FLEET_INSTANCE_FILE_NAME);
    let json = serde_json::to_vec_pretty(manifest)?;
    std::fs::write(&file, json)?;
    ensure_current_symlink(paths, version)?;
    Ok(file)
}

/// Point `versions/current` at `versions/{version}` (idempotent — replaces an
/// existing symlink). The release tooling normally plants this; the Ensign
/// keeps it in sync with the running version so the fleet reader resolves
/// `current` to the live instance.
pub fn ensure_current_symlink(paths: &Paths, version: &str) -> AppResult<()> {
    let current = paths.deployed_current()?;
    // Relative target keeps the symlink portable if the tree is relocated.
    let target = Path::new(version);
    if current.exists() || std::fs::symlink_metadata(&current).is_ok() {
        std::fs::remove_file(&current).ok();
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, &current)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::paths::BUNDLE_ID;
    use crate::fleet::schemas::FleetHealth;

    /// A stub resolver letting tests drive presence deterministically.
    struct StubResolver {
        retroarch: bool,
        cores: bool,
    }
    impl DependencyResolver for StubResolver {
        fn retroarch_present(&self) -> bool {
            self.retroarch
        }
        fn core_present(&self, _system: &str) -> bool {
            self.cores
        }
    }

    fn temp_paths(tag: &str) -> (Paths, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!(
            "harmony-fleet-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        (Paths::with_root(tmp.join(BUNDLE_ID)).expect("root"), tmp)
    }

    #[test]
    fn edges_cover_retroarch_and_every_core_system() {
        let edges = build_dependency_edges(&StubResolver {
            retroarch: true,
            cores: false,
        });
        assert_eq!(edges.len(), 1 + DECLARED_CORE_SYSTEMS.len());
        assert_eq!(edges[0].name, DEP_RETROARCH);
        assert!(edges[0].present);
        for system in DECLARED_CORE_SYSTEMS {
            let name = format!("core:{system}");
            let edge = edges.iter().find(|e| e.name == name).expect("edge");
            assert!(!edge.present);
        }
    }

    #[test]
    fn status_is_ok_only_when_all_present() {
        let id = Identity::default_identity();
        let all = build_dependency_edges(&StubResolver {
            retroarch: true,
            cores: true,
        });
        assert_eq!(build_status(&id, "0.1.0", 1, all).status, FleetHealth::Ok);

        let missing = build_dependency_edges(&StubResolver {
            retroarch: false,
            cores: true,
        });
        assert_eq!(
            build_status(&id, "0.1.0", 1, missing).status,
            FleetHealth::Degraded
        );
    }

    #[test]
    fn status_carries_instance_id_and_version() {
        let id = Identity {
            env: "prod".into(),
            ordinal: 2,
        };
        let status = build_status(&id, "0.1.0", 42, vec![]);
        assert_eq!(status.instance_id, "harmony-prod-2");
        assert_eq!(status.version, "0.1.0");
        assert_eq!(status.uptime_seconds, 42);
    }

    #[test]
    fn write_manifest_emits_integer_schema_and_plants_current_symlink() {
        let (paths, tmp) = temp_paths("write");
        let id = Identity::default_identity();
        let edges = build_dependency_edges(&StubResolver {
            retroarch: true,
            cores: true,
        });
        let manifest = build_manifest(&id, "0.1.0", 8420, edges);

        let file = write_manifest(&paths, &manifest, "v0.1.0").expect("write");
        assert!(file.exists());
        assert_eq!(file.file_name().unwrap(), FLEET_INSTANCE_FILE_NAME);

        // schema_version is an integer in the written file.
        let raw: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        assert!(raw["schema_version"].is_u64());
        assert_eq!(raw["schema_version"], serde_json::json!(1));

        // current symlink resolves to the version dir.
        let current = paths.deployed_current().unwrap();
        let meta = std::fs::symlink_metadata(&current).expect("symlink exists");
        assert!(meta.file_type().is_symlink());
        let resolved = std::fs::read_link(&current).unwrap();
        assert_eq!(resolved, std::path::Path::new("v0.1.0"));

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn current_symlink_is_idempotent() {
        let (paths, tmp) = temp_paths("idem");
        paths.deployed_version_dir("v0.1.0").unwrap();
        ensure_current_symlink(&paths, "v0.1.0").expect("first");
        ensure_current_symlink(&paths, "v0.1.0").expect("second");
        let current = paths.deployed_current().unwrap();
        assert!(std::fs::symlink_metadata(&current).unwrap().file_type().is_symlink());
        std::fs::remove_dir_all(&tmp).ok();
    }
}
