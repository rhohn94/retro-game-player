//! Fleet Status Contract v1 — the serialized shapes the Ensign exposes both
//! over IPC (`get_fleet_status`, architecture-design.md §2.7) and over the
//! localhost HTTP endpoints (`GET /fleet/v1/status`). One file owns every
//! wire-format type so the contract lives in a single place.
//!
//! HARD CONTRACT: `schema_version` serializes as a JSON **integer** (`1`), never
//! a string. It is a `u32` here so serde emits a number; the unit tests assert
//! the rendered JSON is `1`, not `"1"`. Timestamps/durations are seconds.

use serde::{Deserialize, Serialize};

/// The Fleet Status Contract schema version (INTEGER on the wire). Shared by
/// `FleetStatus` and `fleet-instance.json` (`FleetManifest`). Bump only on a
/// breaking shape change; the Mission Control reader branches on it.
pub const FLEET_SCHEMA_VERSION: u32 = 1;

/// Overall health of the instance, as reported in `FleetStatus.status`.
/// Serializes lowercase to match the IPC contract's `"ok" | "degraded"` union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetHealth {
    /// All declared dependency edges are present.
    Ok,
    /// One or more declared dependencies are missing.
    Degraded,
}

/// A single declared dependency edge (e.g. RetroArch, a libretro core). Mirrors
/// the IPC `dependencies` array element shape in §2.7.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DependencyEdge {
    /// Human/machine name of the dependency (e.g. `"retroarch"`, `"core:nes"`).
    pub name: String,
    /// Whether the dependency is currently present/resolvable.
    pub present: bool,
}

impl DependencyEdge {
    /// Construct a dependency edge.
    pub fn new(name: impl Into<String>, present: bool) -> Self {
        Self {
            name: name.into(),
            present,
        }
    }
}

/// Live status payload — served by `get_fleet_status` (IPC) and
/// `GET /fleet/v1/status` (HTTP). Field names are the snake_case wire form; the
/// TS mirror (`src/ipc/fleet.ts`) renames them to camelCase on its side.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FleetStatus {
    /// Contract schema version (INTEGER on the wire).
    pub schema_version: u32,
    /// Stable Ensign instance id `harmony-{env}-{ordinal}`.
    pub instance_id: String,
    /// App version (crate / release manifest version).
    pub version: String,
    /// Overall instance health.
    pub status: FleetHealth,
    /// Seconds since this process began serving fleet status.
    pub uptime_seconds: u64,
    /// Declared dependency edges (RetroArch + cores).
    pub dependencies: Vec<DependencyEdge>,
}

impl FleetStatus {
    /// Derive overall [`FleetHealth`] from the dependency edges: `Ok` iff every
    /// declared edge is present, otherwise `Degraded`.
    pub fn health_from(dependencies: &[DependencyEdge]) -> FleetHealth {
        if dependencies.iter().all(|d| d.present) {
            FleetHealth::Ok
        } else {
            FleetHealth::Degraded
        }
    }
}

/// The `fleet-instance.json` manifest persisted to the deployed root (§4.2).
/// Carries the stable identity, version manifest, and declared dependency edges
/// the fleet/Mission Control reads at rest (independent of a live process).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FleetManifest {
    /// Contract schema version (INTEGER on the wire — hard requirement).
    pub schema_version: u32,
    /// Stable Ensign instance id `harmony-{env}-{ordinal}`.
    pub instance_id: String,
    /// Deployment environment segment of the instance id (e.g. `"local"`).
    pub env: String,
    /// Ordinal segment of the instance id.
    pub ordinal: u32,
    /// App version this manifest describes.
    pub version: String,
    /// Localhost port the status server binds (documented constant).
    pub status_port: u16,
    /// Declared dependency edges (RetroArch + cores).
    pub dependencies: Vec<DependencyEdge>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// HARD CONTRACT: `schema_version` renders as the JSON integer `1`, never
    /// the string `"1"`, in both `FleetStatus` and `FleetManifest`.
    #[test]
    fn schema_version_serializes_as_integer() {
        let status = FleetStatus {
            schema_version: FLEET_SCHEMA_VERSION,
            instance_id: "harmony-local-0".into(),
            version: "0.1.0".into(),
            status: FleetHealth::Ok,
            uptime_seconds: 0,
            dependencies: vec![],
        };
        let v = serde_json::to_value(&status).unwrap();
        assert!(v["schema_version"].is_u64(), "must be a JSON number");
        assert_eq!(v["schema_version"], serde_json::json!(1));
        assert_ne!(v["schema_version"], serde_json::json!("1"));

        let manifest = FleetManifest {
            schema_version: FLEET_SCHEMA_VERSION,
            instance_id: "harmony-local-0".into(),
            env: "local".into(),
            ordinal: 0,
            version: "0.1.0".into(),
            status_port: 8420,
            dependencies: vec![],
        };
        let m = serde_json::to_value(&manifest).unwrap();
        assert!(m["schema_version"].is_u64());
        assert_eq!(m["schema_version"], serde_json::json!(1));
    }

    /// The raw serialized text contains a bare `1` (no quotes) for the contract
    /// key — a belt-and-braces check against accidental stringification.
    #[test]
    fn schema_version_raw_text_is_unquoted() {
        let status = FleetStatus {
            schema_version: FLEET_SCHEMA_VERSION,
            instance_id: "harmony-local-0".into(),
            version: "0.1.0".into(),
            status: FleetHealth::Ok,
            uptime_seconds: 5,
            dependencies: vec![DependencyEdge::new("retroarch", true)],
        };
        let text = serde_json::to_string(&status).unwrap();
        assert!(text.contains("\"schema_version\":1"), "got: {text}");
        assert!(!text.contains("\"schema_version\":\"1\""));
    }

    /// Health derives `Ok` only when every edge is present.
    #[test]
    fn health_derivation() {
        let all_present = vec![
            DependencyEdge::new("retroarch", true),
            DependencyEdge::new("core:nes", true),
        ];
        assert_eq!(FleetStatus::health_from(&all_present), FleetHealth::Ok);

        let one_missing = vec![
            DependencyEdge::new("retroarch", true),
            DependencyEdge::new("core:nes", false),
        ];
        assert_eq!(
            FleetStatus::health_from(&one_missing),
            FleetHealth::Degraded
        );
    }

    /// `status` serializes to the lowercase union the IPC contract documents.
    #[test]
    fn health_serializes_lowercase() {
        assert_eq!(
            serde_json::to_value(FleetHealth::Ok).unwrap(),
            serde_json::json!("ok")
        );
        assert_eq!(
            serde_json::to_value(FleetHealth::Degraded).unwrap(),
            serde_json::json!("degraded")
        );
    }

    /// Round-trips so the at-rest manifest reader (Mission Control) and writer
    /// agree.
    #[test]
    fn manifest_round_trips() {
        let manifest = FleetManifest {
            schema_version: FLEET_SCHEMA_VERSION,
            instance_id: "harmony-prod-3".into(),
            env: "prod".into(),
            ordinal: 3,
            version: "0.1.0".into(),
            status_port: 8420,
            dependencies: vec![DependencyEdge::new("retroarch", false)],
        };
        let text = serde_json::to_string(&manifest).unwrap();
        let back: FleetManifest = serde_json::from_str(&text).unwrap();
        assert_eq!(manifest, back);
    }
}
