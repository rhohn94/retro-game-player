//! Launch descriptor model (v0.31 W311, `non-retro-library-design.md`
//! §Launch descriptors) — the tagged union stored as JSON in
//! `games.launch_descriptor` that tells `launch_game` how to start a
//! non-ROM game. `Retroarch` also has an explicit variant so a descriptor
//! can name the existing path uniformly, but a row with no descriptor at
//! all (the pre-v0.31 default) still resolves to the RetroArch path via
//! [`ResolvedLaunch::for_game`] in `dispatch.rs`.
//!
//! v0.33 W332 adds [`LaunchDescriptor::Crossover`] for the stub-less
//! CrossOver app shape `sources::crossover`'s scanner already emits (see
//! `docs/design/crossover-integration-design.md` §Launch) — stub-backed
//! CrossOver rows keep using the plain `App` variant unchanged.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

/// How to start a game outside RetroArch's ROM+core path.
///
/// Serializes to/from the JSON stored in `games.launch_descriptor`, tagged
/// on a `kind` field (`{"kind": "app", "bundle_path": "..."}`) so the schema
/// is self-describing and forward-compatible with future kinds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LaunchDescriptor {
    /// The existing RetroArch ROM+core path, named explicitly. Rows with no
    /// stored descriptor are treated identically by `dispatch.rs` — this
    /// variant exists so a descriptor can be persisted uniformly if a
    /// caller ever wants to record it.
    Retroarch,
    /// A plain macOS `.app` bundle, launched via `open -a <bundle_path>`.
    App {
        /// Absolute path to the `.app` bundle.
        bundle_path: String,
    },
    /// A Steam title, launched via the `steam://rungameid/<appid>` URL
    /// scheme (opened through `open`, which hands it to the Steam client).
    Steam {
        /// The Steam application id (kept as a string — it is stored and
        /// compared as `games.external_id`, never arithmetic).
        appid: String,
    },
    /// A direct executable spawn with explicit argv — the manual-entry
    /// escape hatch for anything that isn't an `.app` bundle or a Steam
    /// title.
    Exec {
        /// Absolute path to the program to execute.
        program: String,
        /// Arguments passed to the program, in order.
        #[serde(default)]
        args: Vec<String>,
    },
    /// A stub-less CrossOver-installed Windows application (v0.33 W332, see
    /// `docs/design/crossover-integration-design.md` §Launch): CrossOver has
    /// no macOS launcher-stub bundle for this app (the `.cxmenu` fallback
    /// path — `sources::crossover`'s scanner emits this shape only when a
    /// stub is unavailable), so launching goes through CrossOver's own CLI
    /// (`cxstart --bottle <bottle> -- <target>`) instead of `open -a`. Rows with
    /// a stub instead use the ordinary `App` variant above and reuse its
    /// `open -a` launch path unmodified.
    Crossover {
        /// The bottle id (`Bottles/<name>/` directory name) the app lives in.
        bottle: String,
        /// The Windows-side target `cxstart` should launch (a link-record
        /// target path, verbatim from the `.cxmenu` fallback).
        target: String,
    },
}

impl LaunchDescriptor {
    /// Parse a stored `games.launch_descriptor` JSON string.
    ///
    /// A malformed value indicates on-disk corruption or a schema mismatch
    /// (the repo layer is the only writer) — surfaced as `AppError::Internal`
    /// rather than silently defaulting, matching `GameSource::from_db_str`'s
    /// stance on invalid stored data.
    pub fn from_json(raw: &str) -> AppResult<Self> {
        serde_json::from_str(raw).map_err(|e| {
            AppError::Internal(format!("malformed launch_descriptor JSON: {e}"))
        })
    }

    /// Serialize to the JSON form stored in `games.launch_descriptor`.
    pub fn to_json(&self) -> AppResult<String> {
        serde_json::to_string(self).map_err(AppError::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_descriptor_round_trips_through_json() {
        let d = LaunchDescriptor::App {
            bundle_path: "/Applications/Chess.app".to_string(),
        };
        let json = d.to_json().expect("serialize");
        assert_eq!(json, r#"{"kind":"app","bundle_path":"/Applications/Chess.app"}"#);
        let parsed = LaunchDescriptor::from_json(&json).expect("parse");
        assert_eq!(parsed, d);
    }

    #[test]
    fn steam_descriptor_round_trips_through_json() {
        let d = LaunchDescriptor::Steam {
            appid: "620".to_string(),
        };
        let json = d.to_json().expect("serialize");
        assert_eq!(json, r#"{"kind":"steam","appid":"620"}"#);
        let parsed = LaunchDescriptor::from_json(&json).expect("parse");
        assert_eq!(parsed, d);
    }

    #[test]
    fn exec_descriptor_round_trips_with_args() {
        let d = LaunchDescriptor::Exec {
            program: "/usr/local/bin/mygame".to_string(),
            args: vec!["--fullscreen".to_string(), "--profile=1".to_string()],
        };
        let json = d.to_json().expect("serialize");
        let parsed = LaunchDescriptor::from_json(&json).expect("parse");
        assert_eq!(parsed, d);
    }

    #[test]
    fn exec_descriptor_defaults_args_to_empty_when_absent() {
        let parsed = LaunchDescriptor::from_json(r#"{"kind":"exec","program":"/bin/true"}"#)
            .expect("parse");
        assert_eq!(
            parsed,
            LaunchDescriptor::Exec {
                program: "/bin/true".to_string(),
                args: vec![],
            }
        );
    }

    #[test]
    fn retroarch_descriptor_round_trips_through_json() {
        let d = LaunchDescriptor::Retroarch;
        let json = d.to_json().expect("serialize");
        assert_eq!(json, r#"{"kind":"retroarch"}"#);
        let parsed = LaunchDescriptor::from_json(&json).expect("parse");
        assert_eq!(parsed, d);
    }

    #[test]
    fn malformed_json_is_an_internal_error() {
        let result = LaunchDescriptor::from_json("not json");
        assert!(matches!(result, Err(AppError::Internal(_))));
    }

    #[test]
    fn unknown_kind_is_an_internal_error() {
        let result = LaunchDescriptor::from_json(r#"{"kind":"emulator_x"}"#);
        assert!(matches!(result, Err(AppError::Internal(_))));
    }

    #[test]
    fn crossover_descriptor_round_trips_through_json() {
        let d = LaunchDescriptor::Crossover {
            bottle: "Steam".to_string(),
            target: r"C:\Program Files\Old Game\oldgame.exe".to_string(),
        };
        let json = d.to_json().expect("serialize");
        let parsed = LaunchDescriptor::from_json(&json).expect("parse");
        assert_eq!(parsed, d);
    }

    #[test]
    fn crossover_descriptor_matches_the_stubless_shape_w331_emits() {
        // Locks the exact shape `sources::crossover`'s `.cxmenu` fallback
        // path emits (`upsert_discovered_accepts_the_stubless_crossover_descriptor_shape`
        // in `commands/sources.rs`), so W331's output and W332's parser never
        // drift apart.
        let parsed = LaunchDescriptor::from_json(
            r#"{"kind":"crossover","bottle":"Legacy","target":"C:\\Program Files\\Old Game\\oldgame.exe"}"#,
        )
        .expect("parse");
        assert_eq!(
            parsed,
            LaunchDescriptor::Crossover {
                bottle: "Legacy".to_string(),
                target: r"C:\Program Files\Old Game\oldgame.exe".to_string(),
            }
        );
    }

    #[test]
    fn crossover_descriptor_missing_target_is_an_internal_error() {
        let result = LaunchDescriptor::from_json(r#"{"kind":"crossover","bottle":"Legacy"}"#);
        assert!(matches!(result, Err(AppError::Internal(_))));
    }

    #[test]
    fn crossover_descriptor_missing_bottle_is_an_internal_error() {
        let result = LaunchDescriptor::from_json(r#"{"kind":"crossover","target":"C:\\x.exe"}"#);
        assert!(matches!(result, Err(AppError::Internal(_))));
    }
}
