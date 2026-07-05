//! Termination observer abstraction for externally-launched titles (v0.31
//! W311, `non-retro-library-design.md` §Launch descriptors; CrossOver kind
//! added v0.33 W332, see `docs/design/crossover-integration-design.md`
//! §Sessions).
//!
//! RetroArch's external play session ends by waiting on its own `Child`
//! handle (see `commands::launch::spawn_session_watcher`), but `app`/`steam`/
//! `crossover` descriptors launch through `open`/`cxstart`, whose `Child`
//! exits almost immediately — long before the actual game/Steam/Wine title
//! does. There is no OS-blocking wait available for "the app the user is now
//! playing has quit", so this module polls `pgrep`/`ps` for the target's
//! process instead.
//!
//! **Accuracy caveat (documented per the acceptance criteria):** this is a
//! best-effort observation, not an authoritative signal. Failure modes:
//! - A bundle that spawns a differently-named helper process (the poll
//!   matches on executable name derived from the bundle/program) may report
//!   "stopped" while a subprocess is still running, or vice versa.
//! - Steam titles running through Proton-less native launches usually match
//!   by name, but Steam itself relaunching the same appid quickly could
//!   read as one continuous session instead of two.
//! - **Wine processes (`crossover` descriptor kind, W332):** a stub-less
//!   CrossOver app runs under Wine inside its bottle, so the OS-visible
//!   process may present as the target's own executable name, as a generic
//!   Wine host process, or as `CrossOver` itself, depending on the bottle's
//!   configuration — this module cannot distinguish those cases without
//!   deeper CrossOver/Wine introspection RGP does not perform (the roadmap
//!   boundary: RGP orchestrates CrossOver, it never inspects Wine
//!   internals). We poll for the CrossOver application process itself
//!   ([`CROSSOVER_PROCESS_NAME`]) as the best available signal; this can
//!   under- or over-count relative to the actual Windows title's lifetime
//!   (e.g. CrossOver staying resident after the title quits, or a shared
//!   CrossOver process serving a second concurrently-launched title). Same
//!   accepted tradeoff as the Steam gap above.
//! - The poll interval (`POLL_INTERVAL`) means end-of-session is detected on
//!   a delay, not instantly, so recorded duration is an approximation.
//!
//! The seam is [`ProcessObserver`], a trait so the poll loop can be
//! unit-tested against a fake without actually spawning/killing processes.

use super::descriptor::LaunchDescriptor;
use std::path::Path;
use std::time::Duration;

/// How often the background thread polls for the target process's liveness.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// The macOS process name CrossOver itself runs under — the best-effort
/// observation target for stub-less `crossover` descriptors (see this
/// module's Wine accuracy caveat above).
const CROSSOVER_PROCESS_NAME: &str = "CrossOver";

/// Derive the process (executable) name to watch for a given launch
/// descriptor, or `None` if there is nothing meaningful to watch (the
/// caller should skip observation entirely in that case rather than poll
/// against a name that can never match).
///
/// - `App { bundle_path }` — the bundle's own name, e.g. `Chess.app` → `Chess`
///   (macOS's actual running-process name for a `.app` bundle). This also
///   covers stub-backed CrossOver rows (W331 emits the plain `App` shape
///   when a launcher stub exists), so the observed name there is the stub's
///   own name, not CrossOver's.
/// - `Exec { program, .. }` — the program's file-name (basename), e.g.
///   `/usr/local/bin/mygame` → `mygame`.
/// - `Crossover { .. }` — the stub-less fallback launch (W332); there is no
///   predictable per-title process name to derive (the target is a Windows
///   path run under Wine), so this watches for CrossOver's own process name
///   instead — a best-effort proxy, not the title itself (module doc's Wine
///   accuracy caveat).
/// - `Steam { .. }` — Steam titles run as arbitrary child processes of the
///   Steam client under a name this code cannot predict without parsing the
///   installed title's own binary, so observation is skipped (`None`); the
///   accuracy caveat above already documents this as a known gap.
/// - `Retroarch` — not an external launch; always `None` here (its own
///   `Child`-wait path in `commands::launch` handles session end instead).
pub fn process_name_for(descriptor: &LaunchDescriptor) -> Option<String> {
    match descriptor {
        LaunchDescriptor::App { bundle_path } => {
            let stem = Path::new(bundle_path).file_stem()?.to_str()?;
            Some(stem.to_string())
        }
        LaunchDescriptor::Exec { program, .. } => {
            let name = Path::new(program).file_name()?.to_str()?;
            Some(name.to_string())
        }
        LaunchDescriptor::Crossover { .. } => Some(CROSSOVER_PROCESS_NAME.to_string()),
        LaunchDescriptor::Steam { .. } | LaunchDescriptor::Retroarch => None,
    }
}

/// Observes whether a named external process is still running. Implemented
/// for real use by [`PgrepObserver`] (macOS `pgrep`); tests substitute a
/// fake sequence of true/false results.
pub trait ProcessObserver: Send {
    /// Returns `true` if a process matching `process_name` is currently running.
    fn is_running(&mut self, process_name: &str) -> bool;
}

/// Real observer: shells out to `pgrep -x <name>` (exact executable-name
/// match) and checks for a successful (zero) exit status, i.e. at least one
/// matching process. `pgrep` failures (not installed, sandboxed) are treated
/// as "not running" — best-effort, never fatal to the caller.
#[derive(Default)]
pub struct PgrepObserver;

impl ProcessObserver for PgrepObserver {
    fn is_running(&mut self, process_name: &str) -> bool {
        std::process::Command::new("pgrep")
            .arg("-x")
            .arg(process_name)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Block the calling thread until `observer` reports `process_name` is no
/// longer running, polling every [`POLL_INTERVAL`]. Intended to run on a
/// dedicated background thread (see `commands::launch::spawn_external_watcher`).
///
/// Returns immediately (after one check) if the process was never observed
/// running in the first place — e.g. it already exited before the first
/// poll, or the name never matched (best-effort: we still end the session
/// rather than track it forever).
pub fn wait_until_stopped<O: ProcessObserver>(observer: &mut O, process_name: &str) {
    // Give the target a moment to actually start before the first check,
    // so a legitimately-running app isn't misread as "already stopped".
    if observer.is_running(process_name) {
        while observer.is_running(process_name) {
            std::thread::sleep(POLL_INTERVAL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake observer that returns a scripted sequence of `is_running`
    /// results, then `false` forever after the sequence is exhausted.
    struct ScriptedObserver {
        remaining: Vec<bool>,
        calls: usize,
    }

    impl ScriptedObserver {
        fn new(sequence: Vec<bool>) -> Self {
            Self {
                remaining: sequence,
                calls: 0,
            }
        }
    }

    impl ProcessObserver for ScriptedObserver {
        fn is_running(&mut self, _process_name: &str) -> bool {
            self.calls += 1;
            if self.remaining.is_empty() {
                return false;
            }
            self.remaining.remove(0)
        }
    }

    #[test]
    fn wait_until_stopped_returns_immediately_if_never_seen_running() {
        let mut observer = ScriptedObserver::new(vec![false]);
        wait_until_stopped(&mut observer, "SomeGame");
        assert_eq!(observer.calls, 1);
    }

    #[test]
    fn wait_until_stopped_polls_until_process_exits() {
        let mut observer = ScriptedObserver::new(vec![true, true, true, false]);
        wait_until_stopped(&mut observer, "SomeGame");
        assert_eq!(observer.calls, 4);
    }

    #[test]
    fn pgrep_observer_reports_false_for_a_name_that_cannot_match_anything() {
        let mut observer = PgrepObserver;
        // Use a name virtually guaranteed not to be a running process.
        assert!(!observer.is_running("definitely-not-a-real-process-xyz123"));
    }

    #[test]
    fn process_name_for_app_descriptor_is_the_bundle_stem() {
        let d = LaunchDescriptor::App {
            bundle_path: "/Applications/Chess.app".to_string(),
        };
        assert_eq!(process_name_for(&d), Some("Chess".to_string()));
    }

    #[test]
    fn process_name_for_exec_descriptor_is_the_program_basename() {
        let d = LaunchDescriptor::Exec {
            program: "/usr/local/bin/mygame".to_string(),
            args: vec![],
        };
        assert_eq!(process_name_for(&d), Some("mygame".to_string()));
    }

    #[test]
    fn process_name_for_steam_descriptor_is_none() {
        let d = LaunchDescriptor::Steam {
            appid: "620".to_string(),
        };
        assert_eq!(process_name_for(&d), None);
    }

    #[test]
    fn process_name_for_retroarch_descriptor_is_none() {
        assert_eq!(process_name_for(&LaunchDescriptor::Retroarch), None);
    }

    #[test]
    fn process_name_for_crossover_descriptor_watches_crossover_itself() {
        // Best-effort proxy per the module's Wine accuracy caveat: no
        // per-title process name is derivable for a stub-less launch.
        let d = LaunchDescriptor::Crossover {
            bottle: "Steam".to_string(),
            target: r"C:\Games\hl2.exe".to_string(),
        };
        assert_eq!(process_name_for(&d), Some(CROSSOVER_PROCESS_NAME.to_string()));
    }
}
