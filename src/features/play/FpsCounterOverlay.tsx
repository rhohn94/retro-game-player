// FpsCounterOverlay — the optional on-screen FPS readout (v0.29 W281,
// performance-tooling-design.md). Purely presentational: both players own an
// FpsCounter (fpsCounter.ts) instance and pass its live estimate down each
// paint tick; this component just renders the number. Hidden entirely
// (renders nothing, not just visually hidden) unless the Settings toggle is
// on — mirrors MenuHoldIndicator's "no-op at rest" convention so it never
// occupies layout or intercepts pointer events while off.

export interface FpsCounterOverlayProps {
  /** Whether the counter is enabled (the Settings → Playback toggle). */
  enabled: boolean;
  /** The current rolling estimate (fpsCounter.ts); 0 before the first window
   * closes, which reads as "—" rather than a misleading "0". */
  fps: number;
}

export function FpsCounterOverlay({ enabled, fps }: FpsCounterOverlayProps) {
  if (!enabled) return null;
  const display = fps > 0 ? fps.toFixed(0) : "—";
  return (
    <div className="rgp-fps-counter" role="status" aria-label="Frames per second">
      {display} FPS
    </div>
  );
}
