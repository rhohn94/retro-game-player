//! Run telemetry: writes `run.json` in the deployed version dir per the
//! deployed-apps convention (architecture-design.md §4.2). Records the
//! lifecycle of an app run — start, last status, and (on clean shutdown) stop.
//!
//! Field names are kept forward-compatible with the Fleet/Ensign item (W11),
//! which owns `fleet-instance.json` and the localhost status endpoints: the
//! `instance_id` here is a placeholder until W11 plants the stable Ensign
//! identity, and `schema_version` is an INTEGER so the fleet reader can branch
//! on it. Timestamps are Unix epoch **seconds** (`i64`), matching the IPC
//! contract (§2).

use crate::config::paths::{Paths, RUN_FILE_NAME};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// `run.json` schema version (INTEGER; W11 fleet reader branches on this).
pub const RUN_SCHEMA_VERSION: u32 = 1;

/// Placeholder instance id until W11 (Fleet/Ensign) plants the stable
/// `harmony-{env}-{ordinal}` identity. Forward-compatible: W11 overwrites this.
pub const PLACEHOLDER_INSTANCE_ID: &str = "harmony-local-0";

/// Lifecycle status of a run. Serializes lowercase to stay stable across the
/// fleet boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    /// The app started and is (as far as this record knows) running.
    Running,
    /// The app shut down cleanly.
    Stopped,
}

/// The `run.json` payload (§4.2). Captures one run's lifecycle. Written on run
/// start and updated on clean stop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RunRecord {
    /// Schema version (INTEGER).
    pub schema_version: u32,
    /// Stable instance id (placeholder until W11).
    pub instance_id: String,
    /// App version (from the crate version / release manifest).
    pub version: String,
    /// Run start time (Unix epoch seconds).
    pub started_at: i64,
    /// Run stop time (Unix epoch seconds); `None` while running.
    pub stopped_at: Option<i64>,
    /// Current lifecycle status.
    pub status: RunStatus,
}

impl RunRecord {
    /// Build a fresh "running" record stamped at `now`, for `version`.
    pub fn start(version: impl Into<String>) -> Self {
        Self {
            schema_version: RUN_SCHEMA_VERSION,
            instance_id: PLACEHOLDER_INSTANCE_ID.to_string(),
            version: version.into(),
            started_at: now_epoch_secs(),
            stopped_at: None,
            status: RunStatus::Running,
        }
    }

    /// Mark this record stopped at `now`.
    pub fn mark_stopped(&mut self) {
        self.stopped_at = Some(now_epoch_secs());
        self.status = RunStatus::Stopped;
    }

    /// Write this record to `run.json` in the deployed version dir for
    /// `version` (`deployed-apps/harmony/versions/v{version}/run.json`).
    /// Deployed dirs are v-prefixed per architecture §4.2, matching the
    /// Fleet manifest (W11) so `run.json` and `fleet-instance.json` co-locate.
    pub fn write(&self, paths: &Paths, version: &str) -> AppResult<()> {
        let dir = paths.deployed_version_dir(&format!("v{version}"))?;
        let file = dir.join(RUN_FILE_NAME);
        let json = serde_json::to_vec_pretty(self)?;
        std::fs::write(&file, json)?;
        Ok(())
    }
}

/// Convenience used by `harmony_setup`: stamp + write a "running" record for the
/// given app version, returning it so the caller can later `mark_stopped` +
/// re-write. Failures are returned (the setup hook decides whether to warn or
/// abort).
pub fn record_run_start(paths: &Paths, version: &str) -> AppResult<RunRecord> {
    let record = RunRecord::start(version);
    record.write(paths, version)?;
    Ok(record)
}

/// Current time as Unix epoch seconds. Pre-epoch clocks (shouldn't happen)
/// clamp to 0 rather than panic.
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::paths::BUNDLE_ID;

    fn temp_paths(tag: &str) -> (Paths, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!("harmony-tel-{tag}-{}", std::process::id()));
        (
            Paths::with_root(tmp.join(BUNDLE_ID)).expect("root"),
            tmp,
        )
    }

    #[test]
    fn start_record_has_documented_fields() {
        let r = RunRecord::start("0.1.0");
        assert_eq!(r.schema_version, RUN_SCHEMA_VERSION);
        assert_eq!(r.instance_id, PLACEHOLDER_INSTANCE_ID);
        assert_eq!(r.version, "0.1.0");
        assert!(r.started_at > 0);
        assert!(r.stopped_at.is_none());
        assert_eq!(r.status, RunStatus::Running);
    }

    #[test]
    fn mark_stopped_sets_status_and_timestamp() {
        let mut r = RunRecord::start("0.1.0");
        r.mark_stopped();
        assert_eq!(r.status, RunStatus::Stopped);
        assert!(r.stopped_at.is_some());
    }

    #[test]
    fn write_produces_run_json_with_fields() {
        let (paths, tmp) = temp_paths("write");
        let r = record_run_start(&paths, "0.1.0").expect("write");

        let file = paths
            .deployed_version_dir("v0.1.0")
            .unwrap()
            .join(RUN_FILE_NAME);
        assert!(file.exists());

        let parsed: RunRecord =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).expect("parse");
        assert_eq!(parsed, r);

        // Field names are the documented snake_case keys (W11 forward-compat).
        let raw: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        for key in ["schema_version", "instance_id", "version", "started_at", "status"] {
            assert!(raw.get(key).is_some(), "missing key {key}");
        }
        assert_eq!(raw["status"], "running");

        std::fs::remove_dir_all(&tmp).ok();
    }
}
