//! `FrameClock` — an absolute-deadline frame scheduler for the core run loop.
//! The naive `sleep(period - elapsed)` pacing it replaces (W212) restarted
//! from a fresh `Instant` every tick, so macOS's ~0.5–2 ms sleep overshoot
//! accumulated and the core ran measurably below its native fps ("the game is
//! literally slow"). Here the next deadline *accumulates* (`next += period`):
//! overshoot on one tick shortens the wait on the next, so the long-run
//! average cadence is exact. W270 — see
//! docs/design/native-emulation-design.md §2.

use std::time::{Duration, Instant};

/// How close to the deadline the coarse `thread::sleep` is allowed to get.
/// The OS may overshoot a sleep by a millisecond or two, so the final
/// approach is handed to a `yield_now` loop that lands the deadline
/// precisely; 1.5 ms of yielding per frame is cheap (the thread stays
/// runnable but keeps offering its slice back to the scheduler).
const SPIN_THRESHOLD: Duration = Duration::from_micros(1_500);

/// A stall longer than this many periods (machine sleep, a debugger pause, a
/// wedged frame) resyncs the schedule to "now" instead of fast-forwarding
/// through every missed deadline — running the core flat-out to catch up
/// would burst audio/video and pin a CPU for no user-visible benefit.
const STALL_RESYNC_PERIODS: u32 = 4;

/// Paces a loop at a fixed period using absolute deadlines. Not `Sync` — one
/// clock belongs to exactly one loop thread.
pub struct FrameClock {
    period: Duration,
    next_deadline: Instant,
}

impl FrameClock {
    /// A clock whose first tick completes one `period` from now.
    pub fn new(period: Duration) -> Self {
        FrameClock {
            period,
            next_deadline: Instant::now() + period,
        }
    }

    /// Blocks until the current deadline, then advances it by one period.
    /// Coarse-sleeps all but the final [`SPIN_THRESHOLD`], then yields in a
    /// loop to land precisely; see [`Self::advance`] for the stall rule.
    pub fn tick(&mut self) {
        let deadline = self.next_deadline;
        loop {
            let now = Instant::now();
            if now >= deadline {
                self.next_deadline = Self::advance(deadline, self.period, now);
                return;
            }
            let remaining = deadline - now;
            if remaining > SPIN_THRESHOLD {
                std::thread::sleep(remaining - SPIN_THRESHOLD);
            } else {
                std::thread::yield_now();
            }
        }
    }

    /// Restarts the schedule from "now" — call after any deliberate gap in
    /// ticking (the pause→resume path) so the loop doesn't inherit a backlog
    /// of deadlines it was never meant to meet.
    pub fn resync(&mut self) {
        self.next_deadline = Instant::now() + self.period;
    }

    /// The deadline-advance rule, kept pure so it is unit-testable with an
    /// injected "now": normally the deadline accumulates (`deadline +
    /// period`, repaying overshoot), but a stall beyond
    /// [`STALL_RESYNC_PERIODS`] resyncs to `now + period` instead of
    /// fast-forwarding through the missed ticks.
    fn advance(deadline: Instant, period: Duration, now: Instant) -> Instant {
        if now > deadline + period * STALL_RESYNC_PERIODS {
            now + period
        } else {
            deadline + period
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PERIOD: Duration = Duration::from_millis(10);

    #[test]
    fn advance_accumulates_from_the_deadline_not_from_now() {
        let base = Instant::now();
        let deadline = base + PERIOD;
        // 2 ms of overshoot — well within the stall limit.
        let now = deadline + Duration::from_millis(2);
        let next = FrameClock::advance(deadline, PERIOD, now);
        // The next deadline is deadline + period: the 2 ms overshoot is
        // repaid (next - now < period), not carried forward.
        assert_eq!(next, deadline + PERIOD);
        assert!(next - now < PERIOD);
    }

    #[test]
    fn advance_repays_overshoot_right_up_to_the_stall_limit() {
        let base = Instant::now();
        let deadline = base + PERIOD;
        let now = deadline + PERIOD * STALL_RESYNC_PERIODS; // exactly at the limit
        assert_eq!(
            FrameClock::advance(deadline, PERIOD, now),
            deadline + PERIOD
        );
    }

    #[test]
    fn advance_resyncs_after_a_stall_instead_of_fast_forwarding() {
        let base = Instant::now();
        let deadline = base + PERIOD;
        let now = deadline + PERIOD * STALL_RESYNC_PERIODS + Duration::from_millis(1);
        let next = FrameClock::advance(deadline, PERIOD, now);
        // A machine-sleep-sized gap: schedule restarts one period from now,
        // no burst of catch-up ticks.
        assert_eq!(next, now + PERIOD);
    }

    #[test]
    fn resync_moves_the_next_deadline_one_period_from_now() {
        let mut clock = FrameClock::new(PERIOD);
        // Simulate a long pause: the stored deadline is now stale.
        std::thread::sleep(Duration::from_millis(30));
        clock.resync();
        let wait = clock.next_deadline - Instant::now();
        // One period out (allowing for the instants taken between the two
        // `Instant::now()` calls) — not the stale deadline, not a backlog.
        assert!(wait <= PERIOD);
        assert!(wait > PERIOD / 2);
    }

    #[test]
    fn thirty_ticks_at_240hz_land_near_expected_wall_time() {
        // Loose real-time check (CI-tolerant): 30 ticks at 240 Hz must take
        // 125 ms ± 10%. The absolute-deadline design repays per-tick sleep
        // overshoot, so the total should track wall time closely.
        let period = Duration::from_micros(1_000_000 / 240);
        let ticks = 30u32;
        let mut clock = FrameClock::new(period);
        let start = Instant::now();
        for _ in 0..ticks {
            clock.tick();
        }
        let elapsed = start.elapsed();
        let expected = period * ticks;
        assert!(
            elapsed >= expected.mul_f64(0.9) && elapsed <= expected.mul_f64(1.1),
            "expected ~{expected:?}, got {elapsed:?}"
        );
    }
}
