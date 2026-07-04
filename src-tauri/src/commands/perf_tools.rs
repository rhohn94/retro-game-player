//! Emulation performance tooling IPC (v0.29 W281,
//! performance-tooling-design.md): the FPS-counter toggle, the lightweight
//! EJS-path sibling perf log, and the read-back surface the new Settings →
//! Performance GUI panel uses for both paths' logs.
//!
//! The native path's own richer telemetry (frame-time percentiles,
//! dropped-video-frame count) is written directly by
//! `play::native::runtime`'s `PerfLog` — see that module's doc. This file
//! owns everything the EJS path and the GUI panel need instead: EJS has no
//! Rust-side runtime loop (the core runs inside the iframe's own WASM/JS), so
//! its telemetry arrives over `postMessage` → IPC rather than being produced
//! natively here.

use crate::config::{paths::Paths, AppConfig};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;

/// Whether the optional on-screen FPS counter is shown on both play paths
/// (`AppConfig::show_fps_counter`, off by default).
#[tauri::command]
pub fn get_show_fps_counter() -> AppResult<bool> {
    Ok(AppConfig::load(&Paths::app_support()?)?.show_fps_counter)
}

/// Persists the FPS-counter toggle.
#[tauri::command]
pub fn set_show_fps_counter(enabled: bool) -> AppResult<()> {
    let paths = Paths::app_support()?;
    let mut cfg = AppConfig::load(&paths)?;
    cfg.show_fps_counter = enabled;
    cfg.save(&paths)
}

/// One periodic stat report from `player.html`'s in-iframe sampling loop
/// (see that file's `harmony-perf-stats` postMessage handler). `frameTimeMs`
/// is whatever coarse per-frame timing signal EmulatorJS/the sampling loop
/// actually produced for this interval — there is no Rust-side frame clock
/// on this path, so this is intentionally coarser than the native log's
/// percentiles (performance-tooling-design.md: "honestly lighter ... not a
/// forced parity claim").
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EjsPerfReport {
    /// The game id the session belongs to, for the GUI panel's labeling.
    pub game_id: i64,
    /// Effective fps over the report's sampling window.
    pub fps: f64,
    /// Mean frame time over the same window, in milliseconds.
    pub frame_time_ms: f64,
}

/// Formats one EJS perf report as a single log line, mirroring the native
/// log's `[rgp-native] perf: ...` shape (`[rgp-ejs] perf: ...`) so the two
/// files read consistently side by side even though the EJS line carries
/// fewer fields.
fn format_ejs_perf_line(report: &EjsPerfReport) -> String {
    format!(
        "[rgp-ejs] perf: game {} — {:.2} fps, {:.1} ms/frame mean",
        report.game_id, report.fps, report.frame_time_ms
    )
}

/// Appends one periodic EJS-path stat report to the sibling log
/// (`logs/ejs-perf.log`). Best-effort, matching the native log's posture
/// (`perf_file.rs`): an unresolvable logs dir or a failed write is reported
/// back to the caller as an error (unlike the native log's silent in-process
/// degrade) since there is no stderr fallback worth preserving here — the
/// frontend caller already treats every report as fire-and-forget
/// (`.catch(() => undefined)`), so a surfaced error changes nothing
/// user-visible either way.
#[tauri::command]
pub fn report_ejs_perf_stats(report: EjsPerfReport) -> AppResult<()> {
    let path = Paths::app_support()?.ejs_perf_log_file()?;
    append_line(&path, &format_ejs_perf_line(&report))
}

/// Appends `line` (+ trailing newline) to `path`, creating it if absent.
fn append_line(path: &Path, line: &str) -> AppResult<()> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{line}")?;
    Ok(())
}

/// How many of the most recent lines `read_native_perf_log`/`read_ejs_perf_log`
/// return — enough for the GUI panel's table + sparkline to show a
/// meaningful recent trend without reading an unbounded log into memory.
const MAX_RECENT_LINES: usize = 50;

/// Reads the last [`MAX_RECENT_LINES`] non-empty lines of `path`, oldest
/// first. A missing file (no session has logged yet) yields an empty list
/// rather than an error — "nothing recorded yet" is a normal, unremarkable
/// state for a fresh install.
fn tail_lines(path: &Path) -> AppResult<Vec<String>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(path)?;
    let mut lines: Vec<String> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(str::to_string)
        .collect();
    if lines.len() > MAX_RECENT_LINES {
        lines = lines.split_off(lines.len() - MAX_RECENT_LINES);
    }
    Ok(lines)
}

/// The GUI panel's per-path log read result: raw recent lines (already
/// human-readable — both formats are plain text by design) plus the parsed
/// fps series the sparkline draws, so the frontend never has to duplicate
/// the line-format parsing.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerfLogEntries {
    /// Recent raw lines, oldest first, capped at [`MAX_RECENT_LINES`].
    pub lines: Vec<String>,
    /// The fps value parsed out of each line in `lines` (same order/length) —
    /// `None` for a line whose fps field couldn't be parsed (never expected
    /// in practice, but the log is a plain-text file a user could hand-edit).
    pub fps_series: Vec<Option<f64>>,
}

/// Parses the effective-fps value out of one perf log line. Both formats
/// place it as the number immediately preceding a literal `fps` token
/// (`"59.87 fps effective"` / `"59.87 fps,"`), so one small parser covers
/// both `[rgp-native]` and `[rgp-ejs]` lines without depending on either
/// one's exact surrounding punctuation or trailing fields (additive-format-
/// safe: new fields appended anywhere else in the line never break this).
fn parse_fps(line: &str) -> Option<f64> {
    let mut tokens = line.split_whitespace().peekable();
    while let Some(token) = tokens.next() {
        if tokens.peek().map(|next| next.trim_end_matches(',')) == Some("fps") {
            return token.parse::<f64>().ok();
        }
    }
    None
}

fn read_perf_log_entries(path: &Path) -> AppResult<PerfLogEntries> {
    let lines = tail_lines(path)?;
    let fps_series = lines.iter().map(|l| parse_fps(l)).collect();
    Ok(PerfLogEntries { lines, fps_series })
}

/// Recent entries from the native-path log (`logs/native-perf.log`) for the
/// Settings → Performance panel.
#[tauri::command]
pub fn read_native_perf_log() -> AppResult<PerfLogEntries> {
    read_perf_log_entries(&Paths::app_support()?.native_perf_log_file()?)
}

/// Recent entries from the EJS-path sibling log (`logs/ejs-perf.log`) for the
/// Settings → Performance panel.
#[tauri::command]
pub fn read_ejs_perf_log() -> AppResult<PerfLogEntries> {
    read_perf_log_entries(&Paths::app_support()?.ejs_perf_log_file()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("rgp-perf-tools-{tag}-{}", std::process::id()))
    }

    #[test]
    fn format_ejs_perf_line_matches_the_documented_shape() {
        let report = EjsPerfReport {
            game_id: 42,
            fps: 59.873,
            frame_time_ms: 16.42,
        };
        let line = format_ejs_perf_line(&report);
        assert_eq!(line, "[rgp-ejs] perf: game 42 — 59.87 fps, 16.4 ms/frame mean");
    }

    #[test]
    fn parse_fps_reads_the_native_line_shape() {
        let line = "[rgp-native] perf: 59.87 fps effective, ring 82 ms, underrun +0, overrun +0, frame-time p50/p95/p99 16.2/17.0/18.5 ms, dropped-video +0";
        assert_eq!(parse_fps(line), Some(59.87));
    }

    #[test]
    fn parse_fps_reads_the_ejs_line_shape() {
        let line = "[rgp-ejs] perf: game 42 — 59.87 fps, 16.4 ms/frame mean";
        assert_eq!(parse_fps(line), Some(59.87));
    }

    #[test]
    fn parse_fps_returns_none_for_an_unrecognized_line() {
        assert_eq!(parse_fps("not a perf line at all"), None);
    }

    #[test]
    fn tail_lines_returns_empty_for_a_missing_file() {
        let dir = temp_dir("missing");
        let path = dir.join("does-not-exist.log");
        assert_eq!(tail_lines(&path).expect("ok"), Vec::<String>::new());
    }

    #[test]
    fn tail_lines_skips_blank_lines_and_caps_at_the_recent_window() {
        let dir = temp_dir("tail");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("test.log");
        let mut content = String::new();
        for i in 0..(MAX_RECENT_LINES + 10) {
            content.push_str(&format!("line {i}\n\n")); // a blank line between each
        }
        std::fs::write(&path, content).expect("write");

        let lines = tail_lines(&path).expect("ok");
        assert_eq!(lines.len(), MAX_RECENT_LINES);
        // Oldest-first ordering preserved; the tail keeps the MOST recent.
        assert_eq!(lines.first().unwrap(), &format!("line {}", 10));
        assert_eq!(lines.last().unwrap(), &format!("line {}", MAX_RECENT_LINES + 9));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_perf_log_entries_pairs_lines_with_parsed_fps() {
        let dir = temp_dir("entries");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("test.log");
        std::fs::write(
            &path,
            "[rgp-ejs] perf: game 1 — 60.00 fps, 16.7 ms/frame mean\n[rgp-ejs] perf: game 1 — 58.10 fps, 17.2 ms/frame mean\n",
        )
        .expect("write");

        let entries = read_perf_log_entries(&path).expect("ok");
        assert_eq!(entries.lines.len(), 2);
        assert_eq!(entries.fps_series, vec![Some(60.00), Some(58.10)]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn append_line_creates_the_file_and_accumulates() {
        let dir = temp_dir("append");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("test.log");

        append_line(&path, "first").expect("append 1");
        append_line(&path, "second").expect("append 2");

        let content = std::fs::read_to_string(&path).expect("read");
        assert_eq!(content, "first\nsecond\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    // ---- W284 (issue #28): read_native_perf_log / read_ejs_perf_log /
    // report_ejs_perf_stats IPC contract ----
    //
    // Like `get_crt_filter`/`set_crt_filter` (`commands::crt_filter`'s own
    // W284 tests), these three commands resolve `Paths::app_support()`
    // internally rather than taking an injectable root, so calling the real
    // `#[tauri::command]` fns here would touch the developer machine's real
    // app-support dir. These tests instead exercise each command's *exact*
    // body against an isolated `Paths::with_root`, proving the real
    // resolve-path -> read/write-file round trip the commands perform (not
    // just the path-taking helpers `tail_lines`/`read_perf_log_entries`
    // above already cover in isolation).

    fn temp_paths(tag: &str) -> (crate::config::paths::Paths, std::path::PathBuf) {
        let tmp = std::env::temp_dir().join(format!("rgp-perf-tools-cmd-{tag}-{}", std::process::id()));
        let p = crate::config::paths::Paths::with_root(tmp.join(crate::config::paths::BUNDLE_ID))
            .expect("root");
        (p, tmp)
    }

    /// Mirrors `report_ejs_perf_stats`'s exact body against an isolated root.
    fn report_ejs_perf_stats_at(
        paths: &crate::config::paths::Paths,
        report: EjsPerfReport,
    ) -> AppResult<()> {
        let path = paths.ejs_perf_log_file()?;
        append_line(&path, &format_ejs_perf_line(&report))
    }

    /// Mirrors `read_native_perf_log`'s exact body against an isolated root.
    fn read_native_perf_log_at(paths: &crate::config::paths::Paths) -> AppResult<PerfLogEntries> {
        read_perf_log_entries(&paths.native_perf_log_file()?)
    }

    /// Mirrors `read_ejs_perf_log`'s exact body against an isolated root.
    fn read_ejs_perf_log_at(paths: &crate::config::paths::Paths) -> AppResult<PerfLogEntries> {
        read_perf_log_entries(&paths.ejs_perf_log_file()?)
    }

    #[test]
    fn read_native_perf_log_on_a_fresh_install_is_empty_not_an_error() {
        let (paths, tmp) = temp_paths("native-fresh");
        let entries = read_native_perf_log_at(&paths).expect("read");
        assert!(entries.lines.is_empty());
        assert!(entries.fps_series.is_empty());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn report_ejs_perf_stats_then_read_ejs_perf_log_round_trips_a_real_report() {
        let (paths, tmp) = temp_paths("ejs-round-trip");
        report_ejs_perf_stats_at(
            &paths,
            EjsPerfReport {
                game_id: 7,
                fps: 59.5,
                frame_time_ms: 16.8,
            },
        )
        .expect("report 1");
        report_ejs_perf_stats_at(
            &paths,
            EjsPerfReport {
                game_id: 7,
                fps: 60.0,
                frame_time_ms: 16.6,
            },
        )
        .expect("report 2");

        let entries = read_ejs_perf_log_at(&paths).expect("read");
        assert_eq!(entries.lines.len(), 2);
        assert!(entries.lines[0].contains("game 7"));
        assert_eq!(entries.fps_series, vec![Some(59.5), Some(60.0)]);

        // The two logs are genuinely separate files — reading the native log
        // through the same isolated root must not see the EJS report.
        let native_entries = read_native_perf_log_at(&paths).expect("read native");
        assert!(native_entries.lines.is_empty());

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn read_native_perf_log_reflects_a_line_at_the_same_path_the_native_runtime_writes_to() {
        // `native_perf_log_file()` is the same resolved path
        // `play::native::runtime`'s `PerfLogFile` sink writes its
        // `[rgp-native]` lines to (see that module's own perf-line tests);
        // writing one here (matching its documented line shape) proves the
        // GUI-facing read command genuinely reads back from that same path,
        // not a hard-coded/mismatched one.
        let (paths, tmp) = temp_paths("native-real-line");
        let path = paths.native_perf_log_file().expect("path");
        append_line(
            &path,
            "[rgp-native] perf: 59.87 fps effective, ring 82 ms, underrun +0, overrun +0, \
             frame-time p50/p95/p99 16.2/17.0/18.5 ms, dropped-video +0",
        )
        .expect("append");

        let entries = read_native_perf_log_at(&paths).expect("read");
        assert_eq!(entries.lines.len(), 1);
        assert_eq!(entries.fps_series, vec![Some(59.87)]);
        std::fs::remove_dir_all(&tmp).ok();
    }
}
