// CrtCssOverlay — the EJS-path CRT approximation (v0.29 W280,
// crt-filter-design.md). EmulatorJS owns its own WebGL2 canvas INSIDE the
// cross-origin iframe (in-page-play-design.md §2), unreachable from the
// parent for a true per-pixel shader without patching the vendored
// player.html runtime (an explicit non-goal this release). This component is
// the accepted CSS-only approximation instead: a perspective/tilt wrapper
// around the iframe for the curvature illusion, `filter: blur()/saturate()`
// for color-bleed, and two absolutely-positioned overlay divs (scanlines,
// vignette) — all driven by the SAME shared CrtFilterConfig the native
// path's shader consumes, via crtCssMapping.ts's pure mapping functions.
//
// Renders its `children` (the iframe) inside the tilt wrapper so callers
// keep owning the iframe element itself (ref, event listeners) unchanged.

import type { ReactNode } from "react";
import { crtConfigToCssVars } from "./crtCssMapping";
import type { CrtFilterConfig } from "../../ipc/crt-filter";
import "./crt-overlay.css";

export interface CrtCssOverlayProps {
  config: CrtFilterConfig;
  children: ReactNode;
}

/** Wraps EJS iframe content with the CSS-only CRT approximation. */
export function CrtCssOverlay({ config, children }: CrtCssOverlayProps) {
  const vars = crtConfigToCssVars(config);
  return (
    <div className="rgp-crt-frame" style={{ width: "100%", height: "100%" }}>
      <div className="rgp-crt-tilt" style={vars as React.CSSProperties}>
        {children}
      </div>
      <div className="rgp-crt-scanlines" style={vars as React.CSSProperties} />
      <div className="rgp-crt-vignette" style={vars as React.CSSProperties} />
    </div>
  );
}
