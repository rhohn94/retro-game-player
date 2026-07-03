//! Best-effort per-session perf-log file sink (W274). macOS discards stderr
//! for Finder-launched apps, so the 10 s `[rgp-native] perf:` line was
//! unreviewable after a real playtest; [`PerfLogFile`] persists the same
//! lines to a fresh-per-session file under the app's `logs/` dir. Strictly
//! best-effort: a failed open or write degrades silently to stderr-only —
//! never a session error — and all I/O happens on the core thread (where the
//! `eprintln!` already lives), never on the realtime audio path. See
//! docs/design/native-emulation-design.md §2 → "v0.27 (W274)".

use std::fs::File;
use std::io::Write;
use std::path::Path;

/// Appends perf lines to a per-session log file, truncating any previous
/// session's content on creation. Every failure mode disables the sink
/// silently (the stderr copy of each line is unaffected).
pub struct PerfLogFile {
    /// `None` = disabled: no path was configured, the open failed, or a
    /// write failed mid-session.
    file: Option<File>,
}

impl PerfLogFile {
    /// Opens `path` fresh for this session (create + truncate). `None`, or
    /// any open failure (missing parent, unwritable location), yields a
    /// disabled sink — perf lines then go to stderr only.
    pub fn create(path: Option<&Path>) -> Self {
        PerfLogFile {
            file: path.and_then(|p| File::create(p).ok()),
        }
    }

    /// A sink that was never given a path (stderr-only telemetry).
    pub fn disabled() -> Self {
        PerfLogFile { file: None }
    }

    /// Appends `line` (a trailing newline is added). A failed write disables
    /// the sink for the rest of the session rather than erroring or retrying.
    pub fn append_line(&mut self, line: &str) {
        if let Some(file) = self.file.as_mut() {
            if writeln!(file, "{line}").and_then(|()| file.flush()).is_err() {
                self.file = None;
            }
        }
    }

    /// Whether the file sink is live (false once disabled by any failure).
    /// Production code never branches on this — degrade is silent by
    /// contract — so it is test-only observability.
    #[cfg(test)]
    pub fn is_active(&self) -> bool {
        self.file.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_truncates_the_previous_sessions_content() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("native-perf.log");
        std::fs::write(&path, "stale line from last session\n").expect("seed");

        let mut log = PerfLogFile::create(Some(&path));
        assert!(log.is_active());
        log.append_line("fresh line");
        let content = std::fs::read_to_string(&path).expect("read");
        assert_eq!(content, "fresh line\n");
    }

    #[test]
    fn append_line_accumulates_lines_in_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("native-perf.log");
        let mut log = PerfLogFile::create(Some(&path));
        log.append_line("first");
        log.append_line("second");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read"),
            "first\nsecond\n"
        );
    }

    #[test]
    fn unwritable_path_degrades_to_a_silent_no_op() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("missing-subdir").join("native-perf.log");
        let mut log = PerfLogFile::create(Some(&path));
        assert!(!log.is_active());
        log.append_line("goes nowhere, panics never"); // must not error
    }

    #[test]
    fn no_configured_path_yields_a_disabled_sink() {
        let mut log = PerfLogFile::create(None);
        assert!(!log.is_active());
        log.append_line("ignored");
        assert!(!PerfLogFile::disabled().is_active());
    }
}
