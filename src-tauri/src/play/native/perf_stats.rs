//! Frame-time percentile math for the native-path perf log (v0.29 W281,
//! performance-tooling-design.md). Kept as a small, pure, allocation-light
//! module separate from `runtime.rs`'s orchestration so the percentile rule
//! itself is unit-testable without spinning up a core loop — mirrors
//! `clock.rs`'s "pure math, thin orchestration wrapper" split.

use std::time::Duration;

/// Bounds how many per-frame samples one perf-log interval accumulates.
/// `PERF_LOG_INTERVAL` (runtime.rs) is 10 s; even a very high refresh rate
/// (e.g. 240 Hz) is comfortably under this, so the window never has to drop a
/// live sample to stay within it. A hard cap exists anyway so a runaway
/// interval (a core reporting an absurd fps) can't grow this buffer
/// unbounded.
pub const MAX_SAMPLES_PER_WINDOW: usize = 4096;

/// Collects per-frame tick durations for one perf-log interval and reduces
/// them to p50/p95/p99 on demand. `push` is called once per core tick on the
/// core thread only — never the realtime audio path.
#[derive(Default)]
pub struct FrameTimeWindow {
    samples: Vec<Duration>,
}

impl FrameTimeWindow {
    /// Records one frame's wall-clock tick duration. Once
    /// [`MAX_SAMPLES_PER_WINDOW`] is reached, further samples in the same
    /// window are dropped from the percentile calculation (not from the fps
    /// count, which is tracked separately by `PerfLog`'s frame counter) —
    /// bounding memory is worth an infinitesimal percentile-accuracy cost on
    /// a pathological interval.
    pub fn push(&mut self, sample: Duration) {
        if self.samples.len() < MAX_SAMPLES_PER_WINDOW {
            self.samples.push(sample);
        }
    }

    /// Clears every recorded sample, starting a fresh window.
    pub fn reset(&mut self) {
        self.samples.clear();
    }

    /// The p50/p95/p99 frame time across every sample recorded since the
    /// last [`Self::reset`], in milliseconds. `None` if nothing was recorded
    /// (e.g. the whole interval was paused).
    pub fn percentiles_ms(&self) -> Option<FrameTimePercentiles> {
        if self.samples.is_empty() {
            return None;
        }
        let mut sorted = self.samples.clone();
        sorted.sort_unstable();
        Some(FrameTimePercentiles {
            p50: percentile_ms(&sorted, 0.50),
            p95: percentile_ms(&sorted, 0.95),
            p99: percentile_ms(&sorted, 0.99),
        })
    }
}

/// One interval's reduced frame-time percentiles, in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameTimePercentiles {
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
}

/// Nearest-rank percentile over an already-sorted, non-empty slice.
/// `fraction` is `(0, 1]`; the index is clamped into bounds so `1.0` (p100)
/// never overruns.
fn percentile_ms(sorted: &[Duration], fraction: f64) -> f64 {
    let last = sorted.len() - 1;
    let idx = ((sorted.len() as f64) * fraction).ceil() as usize;
    let idx = idx.saturating_sub(1).min(last);
    sorted[idx].as_secs_f64() * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn empty_window_has_no_percentiles() {
        let window = FrameTimeWindow::default();
        assert!(window.percentiles_ms().is_none());
    }

    #[test]
    fn single_sample_is_every_percentile() {
        let mut window = FrameTimeWindow::default();
        window.push(ms(16));
        let p = window.percentiles_ms().expect("has samples");
        assert_eq!(p.p50, 16.0);
        assert_eq!(p.p95, 16.0);
        assert_eq!(p.p99, 16.0);
    }

    #[test]
    fn percentiles_reflect_the_distribution_shape() {
        // 100 samples: the last 6 are slow-frame outliers (nearest-rank
        // indices 94..99, 0-indexed), the rest a fast, steady 16ms — p50
        // stays on the fast frames, p95/p99 land on the outlier tail.
        let mut window = FrameTimeWindow::default();
        for _ in 0..94 {
            window.push(ms(16));
        }
        for _ in 0..6 {
            window.push(ms(100));
        }
        let p = window.percentiles_ms().expect("has samples");
        assert_eq!(p.p50, 16.0);
        assert_eq!(p.p95, 100.0);
        assert_eq!(p.p99, 100.0);
    }

    #[test]
    fn reset_clears_prior_samples() {
        let mut window = FrameTimeWindow::default();
        window.push(ms(50));
        window.reset();
        assert!(window.percentiles_ms().is_none());
    }

    #[test]
    fn samples_beyond_the_cap_are_dropped_not_panicking() {
        let mut window = FrameTimeWindow::default();
        for _ in 0..(MAX_SAMPLES_PER_WINDOW + 10) {
            window.push(ms(16));
        }
        let p = window.percentiles_ms().expect("has samples");
        assert_eq!(p.p50, 16.0); // still well-formed, just capped
    }

    #[test]
    fn percentile_order_is_nondecreasing_on_sorted_input() {
        let mut window = FrameTimeWindow::default();
        for n in 1..=20u64 {
            window.push(ms(n));
        }
        let p = window.percentiles_ms().expect("has samples");
        assert!(p.p50 <= p.p95);
        assert!(p.p95 <= p.p99);
    }
}
