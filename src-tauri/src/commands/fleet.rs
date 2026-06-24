//! Fleet command adapter (W11). Thin `#[tauri::command]` over the shared
//! [`Ensign`] held in Tauri state: returns the live [`FleetStatus`] the same
//! pure builder feeds the localhost `GET /fleet/v1/status` endpoint, so the IPC
//! and HTTP faces never drift. Master contract architecture-design.md §2.7.

use crate::error::AppResult;
use crate::fleet::schemas::FleetStatus;
use crate::fleet::server::Ensign;
use tauri::State;

/// `get_fleet_status` — returns the current [`FleetStatus`] for this instance
/// (`schema_version` serializes as the integer `1`). Reads the shared `Ensign`
/// managed in app state by `harmony_setup` and delegates to the same pure
/// builder the localhost HTTP endpoint uses, so the two faces never drift.
#[tauri::command]
pub async fn get_fleet_status(ensign: State<'_, Ensign>) -> AppResult<FleetStatus> {
    Ok(ensign.current_status())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::paths::{Paths, BUNDLE_ID};
    use crate::fleet::identity::Identity;

    /// The status assembly the command returns is contract-shaped (the command
    /// itself needs Tauri `State`, exercised end-to-end in integration; here we
    /// test the underlying builder the adapter delegates to).
    #[test]
    fn adapter_delegates_to_current_status() {
        let tmp = std::env::temp_dir().join(format!("harmony-cmdfleet-{}", std::process::id()));
        let paths = Paths::with_root(tmp.join(BUNDLE_ID)).expect("root");
        let ensign = Ensign::new(Identity::default_identity(), "0.1.0", paths);
        let status = ensign.current_status();
        assert_eq!(status.instance_id, "harmony-local-0");
        assert_eq!(status.schema_version, 1);
        std::fs::remove_dir_all(&tmp).ok();
    }
}
