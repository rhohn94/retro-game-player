// crtPreviewPattern — synthesizes a static RGBA8888 test-card frame for the
// CRT filter settings panel's live preview (v0.29 W280,
// crt-filter-design.md). No real game session runs inside Settings, so the
// preview needs a deterministic, framework-free image to push through both
// the native path's WebGL2 renderer and the EJS path's CSS overlay side by
// side. Vertical color bars (the classic broadcast test-card layout) make
// scanline/curvature/color-bleed/vignette effects easy to see at a glance.

/** Preview frame dimensions — small enough to be cheap, big enough that
 * scanlines/curvature read clearly at typical settings-panel preview sizes. */
export const PREVIEW_WIDTH = 256;
export const PREVIEW_HEIGHT = 224;

/** The classic 7-bar SMPTE-ish test-card palette (RGB, 0-255 each). */
const BARS: readonly [number, number, number][] = [
  [255, 255, 255], // white
  [255, 255, 0], // yellow
  [0, 255, 255], // cyan
  [0, 255, 0], // green
  [255, 0, 255], // magenta
  [255, 0, 0], // red
  [0, 0, 255], // blue
];

/**
 * Builds one static RGBA8888 test-card frame (vertical color bars), the same
 * pixel format `nativeFrame.ts` parses off the wire — so the identical
 * `CrtWebglRenderer.draw()` call path used for real gameplay renders the
 * preview too, no separate preview-only rendering logic.
 */
export function buildPreviewFrame(
  width: number = PREVIEW_WIDTH,
  height: number = PREVIEW_HEIGHT,
): Uint8ClampedArray<ArrayBuffer> {
  const bytes = new Uint8ClampedArray(width * height * 4) as Uint8ClampedArray<ArrayBuffer>;
  const barWidth = Math.ceil(width / BARS.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bar = BARS[Math.min(BARS.length - 1, Math.floor(x / barWidth))];
      const i = (y * width + x) * 4;
      bytes[i] = bar[0];
      bytes[i + 1] = bar[1];
      bytes[i + 2] = bar[2];
      bytes[i + 3] = 255;
    }
  }
  return bytes;
}
