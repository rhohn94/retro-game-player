//! External-launcher argv construction (v0.31 W311) — builds the
//! `std::process::Command`-ready argv for each non-RetroArch
//! [`LaunchDescriptor`] kind. Mirrors `args.rs`'s space-safety rules:
//! every path/argument is a separate `Vec<String>` element, never
//! concatenated into a shell string.

use super::descriptor::LaunchDescriptor;
use crate::error::{AppError, AppResult};

/// The fully resolved argv for an external (non-RetroArch) launch. Always
/// spawned via `Command::new(&program).args(&args)` — never a shell string —
/// so bundle/executable paths containing spaces are handled correctly.
#[derive(Debug, Clone, PartialEq)]
pub struct ExternalLaunchArgs {
    /// The program to execute (`/usr/bin/open` for `app`/`steam`, or the
    /// descriptor's own `program` for `exec`).
    pub program: String,
    /// Arguments passed to `program`, in order.
    pub args: Vec<String>,
}

/// macOS's `open` utility — used to launch `.app` bundles and hand
/// `steam://` URLs to the registered handler (the Steam client).
const OPEN_UTILITY: &str = "/usr/bin/open";

/// Build the argv for an external-launch descriptor.
///
/// - `App { bundle_path }` → `open -a <bundle_path>`.
/// - `Steam { appid }` → `open steam://rungameid/<appid>`.
/// - `Exec { program, args }` → `<program> <args...>` directly (no `open`
///   wrapper — the program is already an executable, not a bundle or URL).
/// - `Retroarch` is not an external launch; callers must dispatch it via the
///   existing RetroArch path in `args.rs`/`launcher.rs` instead. Passing it
///   here is a caller bug, surfaced as `AppError::Internal`.
///
/// The content/target value is always the last argv element, matching the
/// RetroArch path's convention.
pub fn build(descriptor: &LaunchDescriptor) -> AppResult<ExternalLaunchArgs> {
    match descriptor {
        LaunchDescriptor::App { bundle_path } => Ok(ExternalLaunchArgs {
            program: OPEN_UTILITY.to_string(),
            args: vec!["-a".to_string(), bundle_path.clone()],
        }),
        LaunchDescriptor::Steam { appid } => Ok(ExternalLaunchArgs {
            program: OPEN_UTILITY.to_string(),
            args: vec![steam_url(appid)],
        }),
        LaunchDescriptor::Exec { program, args } => Ok(ExternalLaunchArgs {
            program: program.clone(),
            args: args.clone(),
        }),
        LaunchDescriptor::Retroarch => Err(AppError::Internal(
            "external::build called with a Retroarch descriptor — dispatch it via the \
             RetroArch args/launcher path instead"
                .to_string(),
        )),
    }
}

/// Build the `steam://rungameid/<appid>` URL for a Steam appid.
fn steam_url(appid: &str) -> String {
    format!("steam://rungameid/{appid}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_descriptor_builds_open_dash_a_argv() {
        let d = LaunchDescriptor::App {
            bundle_path: "/Applications/Chess.app".to_string(),
        };
        let result = build(&d).expect("build");
        assert_eq!(result.program, OPEN_UTILITY);
        assert_eq!(result.args, vec!["-a", "/Applications/Chess.app"]);
    }

    #[test]
    fn app_descriptor_preserves_spaces_in_bundle_path_verbatim() {
        let d = LaunchDescriptor::App {
            bundle_path: "/Applications/My Great Game.app".to_string(),
        };
        let result = build(&d).expect("build");
        assert_eq!(result.args[1], "/Applications/My Great Game.app");
        assert!(!result.args[1].contains('"'));
    }

    #[test]
    fn steam_descriptor_builds_rungameid_url() {
        let d = LaunchDescriptor::Steam {
            appid: "620".to_string(),
        };
        let result = build(&d).expect("build");
        assert_eq!(result.program, OPEN_UTILITY);
        assert_eq!(result.args, vec!["steam://rungameid/620"]);
    }

    #[test]
    fn exec_descriptor_uses_program_directly_with_args_in_order() {
        let d = LaunchDescriptor::Exec {
            program: "/usr/local/bin/mygame".to_string(),
            args: vec!["--fullscreen".to_string(), "--slot=2".to_string()],
        };
        let result = build(&d).expect("build");
        assert_eq!(result.program, "/usr/local/bin/mygame");
        assert_eq!(result.args, vec!["--fullscreen", "--slot=2"]);
    }

    #[test]
    fn exec_descriptor_with_no_args_yields_empty_argv() {
        let d = LaunchDescriptor::Exec {
            program: "/bin/true".to_string(),
            args: vec![],
        };
        let result = build(&d).expect("build");
        assert!(result.args.is_empty());
    }

    #[test]
    fn exec_descriptor_preserves_space_containing_args_verbatim() {
        let d = LaunchDescriptor::Exec {
            program: "/usr/local/bin/mygame".to_string(),
            args: vec!["--save-dir=/Users/x/My Saves".to_string()],
        };
        let result = build(&d).expect("build");
        assert_eq!(result.args[0], "--save-dir=/Users/x/My Saves");
    }

    #[test]
    fn retroarch_descriptor_is_rejected_as_internal_error() {
        let result = build(&LaunchDescriptor::Retroarch);
        assert!(matches!(result, Err(AppError::Internal(_))));
    }
}
