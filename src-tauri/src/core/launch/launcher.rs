//! RetroArch process launcher — spawns a detached RetroArch process using the
//! pre-built argument list from `args::build`. Uses `std::process::Command` with
//! separate args (never a shell string) for correctness with space-containing paths.

use crate::error::{AppError, AppResult};
use super::args::RetroArchArgs;

/// Spawn RetroArch as a detached child process.
///
/// The child is detached via `spawn()` rather than `output()` / `wait()` so
/// Harmony does not block waiting for the game session to end. The child's
/// stdin/stdout/stderr are inherited from the parent (for debugging) but Harmony
/// does not wait on them.
///
/// Returns `Ok(())` on successful spawn. A failed spawn (e.g. executable not
/// found, permission denied) maps to [`AppError::Io`].
pub fn spawn(launch_args: &RetroArchArgs) -> AppResult<()> {
    std::process::Command::new(&launch_args.executable)
        .args(&launch_args.args)
        .spawn()
        .map_err(|e| {
            AppError::Io(format!(
                "failed to spawn RetroArch ({}): {}",
                launch_args.executable.display(),
                e
            ))
        })?;
    Ok(())
}
