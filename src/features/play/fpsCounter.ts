// fpsCounter — a small, framework-free rolling FPS estimator shared by both
// play paths' on-screen counter (v0.29 W281, performance-tooling-design.md).
// Deliberately pure/DOM-free (kept the same shape as nativeFrame.ts's parsing
// helpers) so the windowing math is unit-testable without mounting a
// component or a real rAF loop.
//
// Each path feeds it timestamps from whatever signal is cleanest for that
// path's own render cadence — NativePlayer.tsx from its existing paint-loop
// rAF ticks, InPagePlayer.tsx from a dedicated sampling rAF loop against the
// iframe's visible output — never a shared IPC field (the design doc's
// explicit per-path decision: the native core's true tick rate and the EJS
// iframe's rendered cadence are different signals, and conflating them into
// one number would misrepresent whichever path didn't produce it).

/** How often the estimate recomputes, independent of how often `tick` is
 * called — a smoother, more readable on-screen number than reprinting every
 * single frame. */
const UPDATE_INTERVAL_MS = 500;

/** Rolling FPS estimator: call `tick(now)` once per rendered frame; read
 * `fps` for the most recently computed estimate (updated at most once per
 * `UPDATE_INTERVAL_MS`). */
export class FpsCounter {
  private windowStart: number | null = null;
  private frameCount = 0;
  private lastFps = 0;

  /** Records one rendered frame at timestamp `nowMs` (typically a
   * `requestAnimationFrame`/`performance.now()` timestamp). Recomputes `fps`
   * once the current window has elapsed. */
  tick(nowMs: number): void {
    if (this.windowStart === null) {
      this.windowStart = nowMs;
      this.frameCount = 0;
      return;
    }
    this.frameCount += 1;
    const elapsed = nowMs - this.windowStart;
    if (elapsed >= UPDATE_INTERVAL_MS) {
      this.lastFps = (this.frameCount * 1000) / elapsed;
      this.windowStart = nowMs;
      this.frameCount = 0;
    }
  }

  /** The most recently computed estimate (0 until the first window closes). */
  get fps(): number {
    return this.lastFps;
  }

  /** Resets to the initial (no-estimate) state — call when the underlying
   * render cadence restarts from scratch (e.g. a fresh session) so a stale
   * pre-restart estimate doesn't linger on screen. */
  reset(): void {
    this.windowStart = null;
    this.frameCount = 0;
    this.lastFps = 0;
  }
}
