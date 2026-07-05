//! Run telemetry: writes `run.json` in the deployed version dir per the
//! deployed-apps convention (architecture-design.md §4.2). Records the
//! lifecycle of an app run — start, last status, and (on clean shutdown) stop.
//! Also records unhandled Rust panics (W360, error-telemetry-design.md) as
//! `panic.json` alongside `run.json`, via [`install_panic_hook`].
//!
//! Field names are kept forward-compatible with the Fleet/Ensign item (W11),
//! which owns `fleet-instance.json` and the localhost status endpoints: the
//! `instance_id` here is a placeholder until W11 plants the stable Ensign
//! identity, and `schema_version` is an INTEGER so the fleet reader can branch
//! on it. Timestamps are Unix epoch **seconds** (`i64`), matching the IPC
//! contract (§2).

use crate::config::paths::{Paths, PANIC_FILE_NAME, RUN_FILE_NAME};
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

/// A single recorded Rust panic (W360, error-telemetry-design.md §Design
/// "Rust: panic hook -> telemetry"). Last-panic-wins: each panic overwrites
/// `panic.json` rather than appending, matching `run.json`'s single-record
/// shape — this is a crash beacon, not an unbounded log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PanicRecord {
    /// Schema version (INTEGER, same convention as [`RunRecord`]).
    pub schema_version: u32,
    /// App version (from the crate version).
    pub version: String,
    /// The panic's display message (`std::panic::PanicHookInfo::payload`,
    /// downcast to `&str`/`String`, else a fixed placeholder).
    pub message: String,
    /// `file:line:column` if the panic carried location info.
    pub location: Option<String>,
    /// When the panic was recorded (Unix epoch seconds).
    pub occurred_at: i64,
}

impl PanicRecord {
    /// Build a record for `message`/`location` at `version`, stamped `now`.
    pub fn new(version: impl Into<String>, message: String, location: Option<String>) -> Self {
        Self {
            schema_version: RUN_SCHEMA_VERSION,
            version: version.into(),
            message,
            location,
            occurred_at: now_epoch_secs(),
        }
    }

    /// Write this record to `panic.json` in the deployed version dir for
    /// `version`, co-located with `run.json` (§4.2).
    pub fn write(&self, paths: &Paths, version: &str) -> AppResult<()> {
        let dir = paths.deployed_version_dir(&format!("v{version}"))?;
        let file = dir.join(PANIC_FILE_NAME);
        let json = serde_json::to_vec_pretty(self)?;
        std::fs::write(&file, json)?;
        Ok(())
    }
}

/// Build + write a [`PanicRecord`] for `message`/`location` at `version`.
/// Failures are swallowed (returned to the caller as `Err`, never panicking
/// again) — a panic hook that itself panics would abort the process, which
/// defeats the point of recording the original panic.
pub fn record_panic(
    paths: &Paths,
    version: &str,
    message: String,
    location: Option<String>,
) -> AppResult<PanicRecord> {
    let record = PanicRecord::new(version, message, location);
    record.write(paths, version)?;
    Ok(record)
}

/// Extract a human-readable message from a panic payload — `PanicHookInfo`
/// only guarantees `&str`/`String` payloads downcast cleanly (the common
/// case for `panic!("...")` / `.expect("...")`); anything else falls back to
/// a fixed placeholder rather than losing the record entirely.
fn panic_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(s) = info.payload().downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "<non-string panic payload>".to_string()
    }
}

/// Install a `panic::set_hook` that records every panic through
/// [`record_panic`], then chains to whatever hook was previously installed
/// (the default hook's stderr print, in the normal boot path) so this is
/// purely additive — nothing that already relies on stderr output loses it.
///
/// `paths` is cloned into the closure (cheap — a couple of `PathBuf`s) so the
/// hook does not depend on Tauri's managed-state machinery, which may not be
/// reachable from an arbitrary panicking thread. Call once, early in
/// `harmony_setup`, right after [`record_run_start`].
pub fn install_panic_hook(paths: Paths, version: impl Into<String>) {
    let version = version.into();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = panic_message(info);
        let location = info.location().map(|l| format!("{l}"));
        if let Err(e) = record_panic(&paths, &version, message, location) {
            eprintln!("[telemetry] failed to record panic (continuing): {e}");
        }
        previous(info);
    }));
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

    #[test]
    fn record_panic_writes_panic_json_with_fields() {
        let (paths, tmp) = temp_paths("panic-direct");
        let r = record_panic(&paths, "0.1.0", "boom".to_string(), Some("src/x.rs:1:1".into()))
            .expect("write");
        assert_eq!(r.message, "boom");
        assert_eq!(r.location.as_deref(), Some("src/x.rs:1:1"));
        assert!(r.occurred_at > 0);

        let file = paths
            .deployed_version_dir("v0.1.0")
            .unwrap()
            .join(PANIC_FILE_NAME);
        assert!(file.exists());
        let parsed: PanicRecord =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).expect("parse");
        assert_eq!(parsed, r);

        std::fs::remove_dir_all(&tmp).ok();
    }

    // `panic::set_hook`/`take_hook` are process-global state, so the two tests
    // below that install a real hook must never run concurrently with each
    // other (Rust's default test harness runs tests on separate threads in the
    // same process). This mutex serializes just those two.
    static PANIC_HOOK_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn installed_hook_records_a_deliberate_panic() {
        let _guard = PANIC_HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (paths, tmp) = temp_paths("panic-hook");

        // Suppress the chained default hook's stderr print for this
        // deliberate, expected panic — cosmetic only, doesn't affect the
        // hook's telemetry write.
        let prev_default = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        install_panic_hook(paths.clone(), "0.1.0");

        let result = std::panic::catch_unwind(|| {
            panic!("deliberate test panic");
        });
        assert!(result.is_err());

        std::panic::set_hook(prev_default);

        let file = paths
            .deployed_version_dir("v0.1.0")
            .unwrap()
            .join(PANIC_FILE_NAME);
        assert!(file.exists(), "panic hook did not write panic.json");
        let parsed: PanicRecord =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).expect("parse");
        assert_eq!(parsed.message, "deliberate test panic");
        assert!(parsed.location.is_some());

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn panic_message_falls_back_for_non_string_payload() {
        let _guard = PANIC_HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (paths, tmp) = temp_paths("panic-nonstring");
        let prev_default = std::panic::take_hook();
        install_panic_hook(paths.clone(), "0.1.0");
        std::panic::set_hook({
            let paths = paths.clone();
            Box::new(move |info| {
                let message = panic_message(info);
                let _ = record_panic(&paths, "0.1.0", message, None);
            })
        });

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            std::panic::panic_any(42_i32);
        }));
        assert!(result.is_err());

        std::panic::set_hook(prev_default);

        let file = paths
            .deployed_version_dir("v0.1.0")
            .unwrap()
            .join(PANIC_FILE_NAME);
        let parsed: PanicRecord =
            serde_json::from_slice(&std::fs::read(&file).unwrap()).expect("parse");
        assert_eq!(parsed.message, "<non-string panic payload>");

        std::fs::remove_dir_all(&tmp).ok();
    }
}
