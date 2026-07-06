// FpsCounterOverlay — the optional on-screen FPS readout (v0.29 W281,
// performance-tooling-design.md). Purely presentational: both players own an
// FpsCounter (fpsCounter.ts) instance and pass its live estimate down each
// paint tick; this component just renders the number. Hidden entirely
// (renders nothing, not just visually hidden) unless the Settings toggle is
// on — mirrors MenuHoldIndicator's "no-op at rest" convention so it never
// occupies layout or intercepts pointer events while off.
//
// v0.38 W381: an optional second line for the native path's real GPU
// draw-cost reading (drawCostSampler.ts, fed by CrtWebglRenderer's
// EXT_disjoint_timer_query_webgl2 support) — `null`/`undefined` (the EJS
// path, or a browser without the timer-query extension) simply omits the
// line rather than showing a misleading "0 ms".

export interface FpsCounterOverlayProps {
  /** Whether the counter is enabled (the Settings → Playback toggle). */
  enabled: boolean;
  /** The current rolling estimate (fpsCounter.ts); 0 before the first window
   * closes, which reads as "—" rather than a misleading "0". */
  fps: number;
  /** Rolling mean GPU draw cost in ms (drawCostSampler.ts), when available.
   * Omitted or `null` renders no draw-cost line at all — not every path/
   * browser produces this measurement. */
  drawCostMs?: number | null;
}

export function FpsCounterOverlay({ enabled, fps, drawCostMs }: FpsCounterOverlayProps) {
  if (!enabled) return null;
  const display = fps > 0 ? fps.toFixed(0) : "—";
  return (
    <div className="rgp-fps-counter" role="status" aria-label="Frames per second">
      {display} FPS
      {drawCostMs != null && (
        <span className="rgp-fps-counter__draw-cost"> · {drawCostMs.toFixed(2)} ms draw</span>
      )}
    </div>
  );
}
