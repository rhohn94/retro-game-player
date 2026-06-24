//! Health domain (W1 stub). A trivial command the frontend round-trips to prove
//! the IPC seam end-to-end. Later items add real domain adapters as sibling
//! files under `commands/`; this one stays as the canonical minimal example.

use crate::error::AppResult;

/// Liveness check. Returns a fixed reply the frontend renders to prove the
/// invoke pipeline (TS wrapper → Tauri → Rust → typed return) works.
#[tauri::command]
pub async fn ping() -> AppResult<String> {
    Ok("pong".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_pong() {
        // Drive the async command on Tauri's runtime so the test needs no
        // direct tokio dependency.
        let reply = tauri::async_runtime::block_on(ping()).unwrap();
        assert_eq!(reply, "pong");
    }
}
