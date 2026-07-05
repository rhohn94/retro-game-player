//! The periodic `[rgp-native] perf:` line — effective fps, ring fill,
//! underrun/overrun deltas (W270 acceptance), plus frame-time percentiles and
//! a dropped-video-frame delta (v0.29 W281). See
//! docs/design/native-emulation-design.md §2 and performance-tooling-design.md.

use super::session::CoreAudio;
use crate::play::native::audio::PerfCounters;
use crate::play::native::perf_file::PerfLogFile;
use crate::play::native::perf_stats::FrameTimeWindow;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

/// How often the core loop emits the `[rgp-native]` perf line (effective
/// fps, ring fill, underrun/overrun deltas) — frequent enough to correlate
/// with what the ear hears, rare enough to never matter.
pub(super) const PERF_LOG_INTERVAL: Duration = Duration::from_secs(10);

/// Rolling window state for the periodic perf line: effective fps over the
/// window plus ring fill and underrun/overrun deltas, so on-device timing
/// verification is objective (W270 acceptance). Each line goes to stderr
/// *and*, when configured, to the per-session log file — macOS discards
/// stderr for Finder-launched apps, so the file is what makes a real
/// playtest reviewable after the fact (W274).
///
/// v0.29 W281 (performance-tooling-design.md) adds frame-time percentiles
/// (p50/p95/p99) and a dropped-video-frame delta as fields APPENDED to the
/// end of the existing line — the pre-existing prefix
/// (`[rgp-native] perf: {fps} fps effective, ...`) is byte-for-byte unchanged,
/// so any existing consumer/test that only reads that prefix keeps working.
pub(super) struct PerfLog {
    window_start: Instant,
    frames: u64,
    underruns: u64,
    overruns: u64,
    dropped_video_frames: u64,
    /// Per-frame tick durations recorded since the last emitted line —
    /// reduced to p50/p95/p99 and cleared each time the line fires.
    frame_times: FrameTimeWindow,
    /// Best-effort file sink; disabled means stderr-only, never an error.
    file: PerfLogFile,
}

impl PerfLog {
    pub(super) fn new(counters: &PerfCounters, file: PerfLogFile) -> Self {
        PerfLog {
            window_start: Instant::now(),
            frames: counters.frames_run.load(Ordering::Relaxed),
            underruns: counters.underrun_samples.load(Ordering::Relaxed),
            overruns: counters.overrun_samples.load(Ordering::Relaxed),
            dropped_video_frames: counters.dropped_video_frames.load(Ordering::Relaxed),
            frame_times: FrameTimeWindow::default(),
            file,
        }
    }

    /// Records one core-tick's wall-clock duration toward this window's
    /// frame-time percentiles. Called once per tick from `run_core_loop`
    /// (never on the realtime audio path).
    pub(super) fn record_frame_time(&mut self, sample: Duration) {
        self.frame_times.push(sample);
    }

    pub(super) fn log_if_due(&mut self, counters: &PerfCounters, audio: Option<&CoreAudio>) {
        let elapsed = self.window_start.elapsed();
        if elapsed < PERF_LOG_INTERVAL {
            return;
        }
        let frames = counters.frames_run.load(Ordering::Relaxed);
        let underruns = counters.underrun_samples.load(Ordering::Relaxed);
        let overruns = counters.overrun_samples.load(Ordering::Relaxed);
        let dropped_video_frames = counters.dropped_video_frames.load(Ordering::Relaxed);
        let fps = (frames - self.frames) as f64 / elapsed.as_secs_f64();
        // Formatted once so the stderr and file copies are always identical.
        // The pre-existing prefix is untouched; percentiles + dropped-frame
        // count are appended after it (additive-only format, W281).
        let mut line = match audio {
            Some(audio) => format!(
                "[rgp-native] perf: {fps:.2} fps effective, ring {:.0} ms, underrun +{}, overrun +{}",
                audio.producer.fill_ms(audio.device_rate),
                underruns - self.underruns,
                overruns - self.overruns,
            ),
            None => format!("[rgp-native] perf: {fps:.2} fps effective, audio off"),
        };
        match self.frame_times.percentiles_ms() {
            Some(p) => {
                line.push_str(&format!(
                    ", frame-time p50/p95/p99 {:.1}/{:.1}/{:.1} ms",
                    p.p50, p.p95, p.p99
                ));
            }
            None => line.push_str(", frame-time n/a"),
        }
        line.push_str(&format!(
            ", dropped-video +{}",
            dropped_video_frames - self.dropped_video_frames
        ));
        eprintln!("{line}");
        self.file.append_line(&line);
        self.window_start = Instant::now();
        self.frames = frames;
        self.underruns = underruns;
        self.overruns = overruns;
        self.dropped_video_frames = dropped_video_frames;
        self.frame_times.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The additive-format contract (W281 acceptance): the pre-existing
    /// prefix a hypothetical existing consumer might match on
    /// (`[rgp-native] perf: {fps} fps effective, ...`) must still appear
    /// verbatim, with the new percentile/dropped-frame fields appended after
    /// it — never replacing or reordering the original fields.
    #[test]
    fn perf_log_line_is_additive_over_the_pre_w281_format() {
        let counters = PerfCounters::default();
        let mut perf = PerfLog::new(&counters, PerfLogFile::disabled());
        perf.record_frame_time(Duration::from_millis(16));
        perf.record_frame_time(Duration::from_millis(17));
        counters.frames_run.fetch_add(120, Ordering::Relaxed);
        counters.dropped_video_frames.fetch_add(3, Ordering::Relaxed);
        perf.window_start = Instant::now() - PERF_LOG_INTERVAL;

        // audio == None exercises the pre-W281 "audio off" branch verbatim.
        perf.log_if_due(&counters, None);

        // log_if_due doesn't return the line, so re-derive deterministically
        // via the file sink to assert on its exact text.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("native-perf.log");
        let mut perf = PerfLog::new(&counters, PerfLogFile::create(Some(&path)));
        perf.record_frame_time(Duration::from_millis(16));
        perf.window_start = Instant::now() - PERF_LOG_INTERVAL;
        perf.log_if_due(&counters, None);

        let content = std::fs::read_to_string(&path).expect("read");
        assert!(
            content.starts_with("[rgp-native] perf: "),
            "prefix changed: {content}"
        );
        assert!(content.contains("fps effective, audio off"));
        assert!(content.contains("frame-time p50/p95/p99"));
        assert!(content.contains("dropped-video +"));
    }

    #[test]
    fn perf_log_reports_frame_time_na_when_no_samples_recorded() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("native-perf.log");
        let counters = PerfCounters::default();
        let mut perf = PerfLog::new(&counters, PerfLogFile::create(Some(&path)));
        perf.window_start = Instant::now() - PERF_LOG_INTERVAL;

        perf.log_if_due(&counters, None);

        let content = std::fs::read_to_string(&path).expect("read");
        assert!(content.contains("frame-time n/a"));
    }
}
