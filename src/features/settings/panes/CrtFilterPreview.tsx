// CrtFilterPreview — the settings panel's live preview (v0.29 W280,
// crt-filter-design.md's "settings panel with sliders + presets and live
// preview" acceptance criterion). Renders the SAME static color-bar test
// card (crtPreviewPattern.ts) through both real pipelines side by side:
// left through CrtWebglRenderer (exactly what the native path draws),
// right through CrtCssOverlay (exactly what the EJS path approximates) —
// so a slider drag visibly updates both at once, proving the one shared
// config actually reaches both play paths.

import { useEffect, useRef, useState } from "react";
import { CrtCssOverlay } from "../../play/CrtCssOverlay";
import { CrtWebglRenderer } from "../../play/crtWebglRenderer";
import { buildPreviewFrame, PREVIEW_HEIGHT, PREVIEW_WIDTH } from "../../play/crtPreviewPattern";
import type { CrtFilterConfig } from "../../../ipc/crt-filter";

/** Renders the shared test-card frame (crtPreviewPattern.ts, the SAME pixels
 * the native preview draws) to an offscreen canvas once and returns it as a
 * data URL — reused as the EJS preview's stand-in "game" image so the CSS
 * approximation is judged against the exact same source picture rather than
 * a separately hand-picked set of colors. */
function usePreviewCardDataUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(buildPreviewFrame(), PREVIEW_WIDTH, PREVIEW_HEIGHT), 0, 0);
    setUrl(canvas.toDataURL());
  }, []);
  return url;
}

/** Renders the native-path preview: a real WebGL2 canvas drawing the same
 * shader gameplay uses, fed the static test-card frame. */
function NativePreviewCanvas({ config }: { config: CrtFilterConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CrtWebglRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    try {
      rendererRef.current = new CrtWebglRenderer(canvas);
    } catch {
      rendererRef.current = null; // no WebGL2 in this environment — panel still renders, just no preview
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.draw(buildPreviewFrame(), PREVIEW_WIDTH, PREVIEW_HEIGHT, config);
  }, [config]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Native path preview"
      style={{ width: "100%", aspectRatio: `${PREVIEW_WIDTH} / ${PREVIEW_HEIGHT}`, imageRendering: "pixelated" }}
    />
  );
}

/** Renders the EJS-path preview: the same CSS overlay wrapped around an
 * `<img>` of the shared test-card frame, standing in for the iframe (no real
 * player.html runs inside Settings). */
function EjsPreviewCard({ config }: { config: CrtFilterConfig }) {
  const dataUrl = usePreviewCardDataUrl();
  return (
    <div style={{ width: "100%", aspectRatio: `${PREVIEW_WIDTH} / ${PREVIEW_HEIGHT}` }}>
      <CrtCssOverlay config={config}>
        {dataUrl && <img src={dataUrl} alt="EJS path preview" style={{ imageRendering: "pixelated" }} />}
      </CrtCssOverlay>
    </div>
  );
}

export interface CrtFilterPreviewProps {
  config: CrtFilterConfig;
}

/** Side-by-side live preview: native WebGL2 shader (left) vs. EJS CSS
 * approximation (right), both fed the same config and the same test card. */
export function CrtFilterPreview({ config }: CrtFilterPreviewProps) {
  return (
    <div style={{ display: "flex", gap: 16 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--aura-on-surface-muted)" }}>Native path (WebGL2)</span>
        <div style={{ borderRadius: "var(--aura-radius-md)", overflow: "hidden", background: "black" }}>
          <NativePreviewCanvas config={config} />
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--aura-on-surface-muted)" }}>EJS path (CSS approximation)</span>
        <div style={{ borderRadius: "var(--aura-radius-md)", overflow: "hidden", background: "black" }}>
          <EjsPreviewCard config={config} />
        </div>
      </div>
    </div>
  );
}
