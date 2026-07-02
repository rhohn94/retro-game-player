//! RetroArch process launcher — spawns a RetroArch process using the
//! pre-built argument list from `args::build`. Uses `std::process::Command` with
//! separate args (never a shell string) for correctness with space-containing paths.

use crate::error::{AppError, AppResult};
use super::args::RetroArchArgs;
use std::process::Child;

/// Spawn RetroArch, returning the running [`Child`] handle.
///
/// The child's stdin/stdout/stderr are inherited from the parent (for
/// debugging). The caller decides whether to wait on it: `launch_game`
/// (v0.26 W264) waits on a background thread so the external play path's
/// session end fires exactly when the game process actually exits, without
/// blocking the IPC call itself.
///
/// Returns `Ok(Child)` on successful spawn. A failed spawn (e.g. executable
/// not found, permission denied) maps to [`AppError::Io`].
pub fn spawn(launch_args: &RetroArchArgs) -> AppResult<Child> {
    std::process::Command::new(&launch_args.executable)
        .args(&launch_args.args)
        .spawn()
        .map_err(|e| {
            AppError::Io(format!(
                "failed to spawn RetroArch ({}): {}",
                launch_args.executable.display(),
                e
            ))
        })
}
