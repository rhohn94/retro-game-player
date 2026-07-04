// crtCssMapping — pure functions mapping the shared CrtFilterConfig into the
// CSS custom-property values CrtCssOverlay.tsx applies to the EJS iframe
// wrapper (v0.29 W280, crt-filter-design.md's CSS-only approximation).
// Framework-free and unit-testable independent of any DOM/component.

import { toUnit } from "./crtFilter";
import type { CrtFilterConfig } from "../../ipc/crt-filter";

/** Scanline overlay opacity at 100% scanline intensity — deliberately less
 * than 1 so full intensity still reads as translucent lines over the game,
 * not solid black bars. */
const MAX_SCANLINE_OPACITY = 0.35;

/** Vignette overlay opacity at 100% vignette intensity. */
const MAX_VIGNETTE_OPACITY = 0.55;

/** Maximum `blur()` radius (px) at 100% color-bleed intensity — a small
 * blur reads as analog softness without turning the picture to mush. */
const MAX_BLEED_BLUR_PX = 1.5;

/** Saturation boost at 100% color-bleed intensity (CRT phosphor "bloom"
 * reads as slightly oversaturated, not desaturated). */
const MAX_BLEED_SATURATE_PCT = 40;

/** Maximum inward 3D tilt (deg) at 100% curvature intensity — a subtle
 * perspective illusion, not a fisheye. */
const MAX_CURVATURE_TILT_DEG = 4;

/** Maximum corner-radius (px) at 100% curvature intensity — reads as a
 * rounded CRT bezel edge. */
const MAX_CURVATURE_RADIUS_PX = 28;

/** The CSS custom-property values for one CRT config, as plain strings ready
 * to assign to a style object (`React.CSSProperties` with a string index, or
 * `element.style.setProperty`). Keys match `crt-overlay.css`'s consumed
 * `--rgp-crt-*` custom properties exactly. */
export interface CrtCssVars {
  "--rgp-crt-scanline-opacity": string;
  "--rgp-crt-vignette-opacity": string;
  "--rgp-crt-bleed-blur": string;
  "--rgp-crt-bleed-saturate": string;
  "--rgp-crt-curvature-tilt": string;
  "--rgp-crt-curvature-radius": string;
}

/** Maps a shared CRT filter config into the overlay's CSS custom properties. */
export function crtConfigToCssVars(config: CrtFilterConfig): CrtCssVars {
  const scanline = toUnit(config.scanlines);
  const vignette = toUnit(config.vignette);
  const bleed = toUnit(config.colorBleed);
  const curvature = toUnit(config.curvature);
  return {
    "--rgp-crt-scanline-opacity": String(scanline * MAX_SCANLINE_OPACITY),
    "--rgp-crt-vignette-opacity": String(vignette * MAX_VIGNETTE_OPACITY),
    "--rgp-crt-bleed-blur": `${bleed * MAX_BLEED_BLUR_PX}px`,
    "--rgp-crt-bleed-saturate": `${100 + bleed * MAX_BLEED_SATURATE_PCT}%`,
    "--rgp-crt-curvature-tilt": `${curvature * MAX_CURVATURE_TILT_DEG}deg`,
    "--rgp-crt-curvature-radius": `${curvature * MAX_CURVATURE_RADIUS_PX}px`,
  };
}
