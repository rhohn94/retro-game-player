//! External-launcher argv construction (v0.31 W311; CrossOver kind added
//! v0.33 W332, see `docs/design/crossover-integration-design.md` §Launch) —
//! builds the `std::process::Command`-ready argv for each non-RetroArch
//! [`LaunchDescriptor`] kind. Mirrors `args.rs`'s space-safety rules:
//! every path/argument is a separate `Vec<String>` element, never
//! concatenated into a shell string.

use super::descriptor::LaunchDescriptor;
use crate::core::sources::crossover;
use crate::error::{AppError, AppResult};
use std::path::Path;

/// The bundle-relative path (inside `CrossOver.app`) to CrossOver's bundled
/// CLI launcher, used by the stub-less `Crossover` descriptor kind (design
/// doc §Launch — implementer-verified binary name against CrossOver's
/// documented install layout; no real install was available in this
/// environment, tracked as the design doc's real-install follow-up).
const CXSTART_RELATIVE_PATH: &str = "Contents/SharedSupport/CrossOver/bin/cxstart";

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
/// - `Crossover { bottle, target }` → `<CrossOver.app>/Contents/SharedSupport/
///   CrossOver/bin/cxstart --bottle <bottle> <target>`, as separate argv
///   elements (never a shell string, same rule as every other kind). Missing
///   `CrossOver.app` surfaces as `AppError::Dependency` here, before any
///   process is spawned — the row is untouched (design doc §Launch: "row
///   stays, same posture as a moved GOG bundle").
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
        LaunchDescriptor::Crossover { bottle, target } => build_crossover(bottle, target),
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

/// Build the `cxstart --bottle <bottle> <target>` argv for a stub-less
/// CrossOver descriptor (design doc §Launch). Locates the installed
/// `CrossOver.app` via the single shared detection helper
/// (`core::sources::crossover::locate_app_bundle`) rather than duplicating
/// its candidate-roots list; absence surfaces as `AppError::Dependency`
/// (built by [`crossover_missing_error`]) before any process is spawned.
/// Argv assembly itself is delegated to [`cxstart_args`], a pure function
/// kept separate so it can be unit-tested against an arbitrary bundle path
/// without depending on real filesystem state.
fn build_crossover(bottle: &str, target: &str) -> AppResult<ExternalLaunchArgs> {
    let app_bundle = crossover::locate_app_bundle().ok_or_else(crossover_missing_error)?;
    Ok(cxstart_args(&app_bundle, bottle, target))
}

/// The `AppError::Dependency` raised when `CrossOver.app` cannot be located
/// at launch time — same "row stays, actionable message" posture as
/// `commands::launch::resolve_retroarch_exe`'s missing-RetroArch error.
fn crossover_missing_error() -> AppError {
    AppError::Dependency(
        "CrossOver is not installed. \
         Download it from https://www.codeweavers.com/crossover and install it, \
         then try launching this title again."
            .to_string(),
    )
}

/// Pure argv assembly for the `cxstart --bottle <bottle> <target>` launch,
/// given an already-located `CrossOver.app` bundle path. `bottle` and
/// `target` are always separate argv elements — never concatenated into a
/// shell string — so spaces and non-ASCII characters in either are handled
/// correctly by the eventual `Command::new(..).args(..)` spawn.
fn cxstart_args(app_bundle: &Path, bottle: &str, target: &str) -> ExternalLaunchArgs {
    let cxstart = app_bundle.join(CXSTART_RELATIVE_PATH);
    ExternalLaunchArgs {
        program: cxstart.to_string_lossy().into_owned(),
        args: vec![
            "--bottle".to_string(),
            bottle.to_string(),
            target.to_string(),
        ],
    }
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

    // --- Crossover descriptor (v0.33 W332) ---

    #[test]
    fn cxstart_args_builds_the_expected_argv_shape() {
        let result = cxstart_args(Path::new("/Applications/CrossOver.app"), "Steam", "C:\\hl2.exe");
        assert_eq!(
            result.program,
            "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/cxstart"
        );
        assert_eq!(result.args, vec!["--bottle", "Steam", "C:\\hl2.exe"]);
    }

    #[test]
    fn cxstart_args_preserves_spaces_in_bottle_and_target_as_separate_argv_elements() {
        let result = cxstart_args(
            Path::new("/Applications/CrossOver.app"),
            "My Bottle",
            r"C:\Program Files\Old Game\oldgame.exe",
        );
        assert_eq!(result.args[1], "My Bottle");
        assert_eq!(result.args[2], r"C:\Program Files\Old Game\oldgame.exe");
        // Never concatenated into a shell string / quoted — each piece is
        // its own argv element, verbatim.
        assert_eq!(result.args.len(), 3);
        assert!(!result.args.iter().any(|a| a.contains('"')));
    }

    #[test]
    fn cxstart_args_preserves_unicode_in_bottle_and_target() {
        let result = cxstart_args(
            Path::new("/Applications/CrossOver.app"),
            "日本語ボトル",
            r"C:\Games\ゲーム\café.exe",
        );
        assert_eq!(result.args[1], "日本語ボトル");
        assert_eq!(result.args[2], r"C:\Games\ゲーム\café.exe");
    }

    #[test]
    fn cxstart_args_never_joins_bottle_and_target_into_one_string() {
        // Regression guard for the argv-safety rule: bottle/target must stay
        // separate `Vec<String>` elements even when either contains spaces
        // that could tempt a shell-string join.
        let result = cxstart_args(Path::new("/Applications/CrossOver.app"), "A B", "C D");
        assert_eq!(result.args, vec!["--bottle", "A B", "C D"]);
    }

    #[test]
    fn crossover_missing_error_is_a_dependency_error() {
        // Exercises the exact error `build_crossover` raises when
        // `crossover::locate_app_bundle` returns `None`, without depending
        // on whether the machine running this test happens to have
        // CrossOver installed (design doc: "no CrossOver required on the
        // build machine") — the row stays untouched (design doc §Launch).
        let err = crossover_missing_error();
        assert!(matches!(err, AppError::Dependency(_)));
    }

    #[test]
    fn crossover_descriptor_dispatches_through_build_crossover() {
        // `build()` routes the `Crossover` variant to `build_crossover`,
        // which either succeeds with a `cxstart` argv (if CrossOver happens
        // to be installed on the machine running this test) or fails with
        // `AppError::Dependency` (if not) — both are the only valid outcomes,
        // unlike an `Internal`/`Io` error which would indicate a dispatch bug.
        let d = LaunchDescriptor::Crossover {
            bottle: "Steam".to_string(),
            target: r"C:\Games\hl2.exe".to_string(),
        };
        match build(&d) {
            Ok(args) => assert!(args.program.ends_with(CXSTART_RELATIVE_PATH)),
            Err(e) => assert!(matches!(e, AppError::Dependency(_))),
        }
    }
}
