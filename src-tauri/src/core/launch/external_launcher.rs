//! External-process spawner (v0.31 W311) — spawns the argv built by
//! `external::build` using separate args (never a shell string), mirroring
//! `launcher.rs`'s RetroArch spawn.

use super::external::ExternalLaunchArgs;
use crate::error::{AppError, AppResult};
use std::process::Child;

/// Spawn an external launch (`open -a <bundle>`, `open steam://…`, or a
/// direct `exec`), returning the running [`Child`] handle.
///
/// Unlike the RetroArch path, `open`-based launches (`app`/`steam`) hand off
/// to a helper process that exits almost immediately once it has told the
/// target app/Steam client to start — the spawned `Child` here is `open`
/// itself, not the game. Termination tracking for those two kinds therefore
/// cannot rely on waiting on this `Child` (see `observer.rs`); `exec`
/// descriptors spawn the game directly, so waiting on `Child` there *is*
/// meaningful.
pub fn spawn(launch_args: &ExternalLaunchArgs) -> AppResult<Child> {
    std::process::Command::new(&launch_args.program)
        .args(&launch_args.args)
        .spawn()
        .map_err(|e| {
            AppError::Io(format!(
                "failed to spawn external launch ({}): {}",
                launch_args.program, e
            ))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawning_a_nonexistent_program_surfaces_io_error() {
        let args = ExternalLaunchArgs {
            program: "/nonexistent/binary/does-not-exist".to_string(),
            args: vec![],
        };
        let result = spawn(&args);
        assert!(matches!(result, Err(AppError::Io(_))));
    }

    #[test]
    fn spawning_a_real_program_succeeds() {
        let args = ExternalLaunchArgs {
            program: "/usr/bin/true".to_string(),
            args: vec![],
        };
        let mut child = spawn(&args).expect("spawn should succeed");
        let status = child.wait().expect("wait should succeed");
        assert!(status.success());
    }
}
