// DrawCostSampler — a small, framework-free rolling aggregator over the
// native path's real GPU draw-cost samples (v0.38 W381,
// performance-tooling-design.md §Frame-path measurements, crt-filter-design.md
// §measurement). CrtWebglRenderer exposes one `lastDrawCostMs` reading per
// resolved `EXT_disjoint_timer_query_webgl2` query (feature-detected there,
// `null` when unavailable); this class turns that intermittent stream of
// samples into a steady rolling mean the same way fpsCounter.ts turns raw
// paint ticks into a steady fps estimate — same "framework-free, DOM-free,
// unit-testable without a browser" shape as its sibling.
//
// This in-memory rolling mean feeds the on-screen FPS overlay's live second
// line only — it is NOT the durable record. Each raw resolved sample is also
// reported over IPC (`ipc/perf-tools.ts`'s `reportDrawCostSample`, called
// from `NativePlayer.tsx`) to its own sibling perf log
// (`logs/draw-cost-perf.log`, `commands::perf_tools::report_draw_cost_sample`
// / `read_draw_cost_log`) that the Settings → Performance panel reads back —
// the same "append over IPC, no Rust-side runtime loop" shape the EJS path
// already uses (`report_ejs_perf_stats`). `native-perf.log` itself stays
// untouched: it's owned end-to-end by `play::native::runtime` (W380's
// frame-path perf-counter work, a different item in this same release,
// frozen IPC frame contract) and this measurement never writes to it. See
// crt-filter-design.md §measurement for the full record.

/** How many recent samples the rolling mean considers — enough to smooth out
 * a single noisy query without going stale across many seconds of play. */
const WINDOW_SIZE = 30;

/** Rolling mean over the most recent GPU draw-cost samples (milliseconds).
 * Call `record(ms)` each time `CrtWebglRenderer.lastDrawCostMs` yields a new
 * (non-null) value; read `meanMs` for the current estimate. */
export class DrawCostSampler {
  private readonly samples: number[] = [];

  /** Records one resolved draw-cost sample, in milliseconds. Negative or
   * non-finite values are ignored (a driver oddity, never expected in
   * practice) rather than corrupting the rolling mean. */
  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > WINDOW_SIZE) this.samples.shift();
  }

  /** The rolling mean of every sample currently in the window; `null` before
   * the first sample has been recorded (distinct from "measured as zero"). */
  get meanMs(): number | null {
    if (this.samples.length === 0) return null;
    const sum = this.samples.reduce((total, ms) => total + ms, 0);
    return sum / this.samples.length;
  }

  /** How many samples currently sit in the window — test/debug observability
   * for the windowing behavior, not consumed by production callers. */
  get sampleCount(): number {
    return this.samples.length;
  }

  /** Resets to the initial (no-samples) state — call when the underlying
   * render session restarts from scratch (e.g. a fresh game) so a stale
   * pre-restart estimate doesn't linger. */
  reset(): void {
    this.samples.length = 0;
  }
}
