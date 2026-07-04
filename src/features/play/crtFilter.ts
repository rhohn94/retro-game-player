// crtFilter — the shared CRT-filter config shape + preset table (v0.29 W280,
// crt-filter-design.md). Pure module (no React, no WebGL, no DOM) so the
// preset math and clamping are unit-testable independent of either play
// path's rendering — NativeCrtRenderer.ts (WebGL2) and crtOverlay.ts (CSS)
// both consume `CrtFilterConfig` from here, never re-deriving the intensities.

import type { CrtFilterConfig, CrtPreset } from "../../ipc/crt-filter";

export type { CrtFilterConfig, CrtPreset } from "../../ipc/crt-filter";

/** Every effect intensity is a percentage in this inclusive range. */
export const INTENSITY_MIN = 0;
export const INTENSITY_MAX = 100;

/** The filter is fully off — every effect at zero, matching the Rust
 * `CrtPreset::Off` intensities exactly (config/mod.rs). */
export const CRT_FILTER_OFF: CrtFilterConfig = {
  scanlines: 0,
  curvature: 0,
  colorBleed: 0,
  vignette: 0,
  preset: "off",
};

/** The four named presets, keyed by id, in the order the settings panel
 * displays them. Values mirror `CrtPreset::intensities()` in
 * `src-tauri/src/config/mod.rs` exactly — keep the two in sync. */
export const CRT_PRESETS: Record<CrtPreset, CrtFilterConfig> = {
  off: CRT_FILTER_OFF,
  classic: { scanlines: 55, curvature: 25, colorBleed: 35, vignette: 30, preset: "classic" },
  arcade: { scanlines: 70, curvature: 55, colorBleed: 45, vignette: 55, preset: "arcade" },
  sharp: { scanlines: 20, curvature: 0, colorBleed: 10, vignette: 10, preset: "sharp" },
};

/** Display order + label for the settings panel's preset buttons. */
export const CRT_PRESET_LIST: { id: CrtPreset; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "classic", label: "Classic CRT" },
  { id: "arcade", label: "Arcade Cabinet" },
  { id: "sharp", label: "Sharp" },
];

/** Clamps a single intensity into [0, 100]; non-finite input becomes 0. */
export function clampIntensity(value: number): number {
  if (!Number.isFinite(value)) return INTENSITY_MIN;
  return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, Math.round(value)));
}

/** Clamps every intensity field of a config; `preset` passes through. */
export function clampCrtFilter(config: CrtFilterConfig): CrtFilterConfig {
  return {
    scanlines: clampIntensity(config.scanlines),
    curvature: clampIntensity(config.curvature),
    colorBleed: clampIntensity(config.colorBleed),
    vignette: clampIntensity(config.vignette),
    preset: config.preset,
  };
}

/** The preset id whose intensities exactly match `config`, or `null` if the
 * current sliders don't match any named preset (a free-tweaked mix). Ignores
 * `config.preset` itself — recomputed from the intensities so a manually
 * dragged slider is detected even if the caller forgot to clear the field. */
export function matchingPreset(config: CrtFilterConfig): CrtPreset | null {
  for (const [id, preset] of Object.entries(CRT_PRESETS) as [CrtPreset, CrtFilterConfig][]) {
    if (
      preset.scanlines === config.scanlines &&
      preset.curvature === config.curvature &&
      preset.colorBleed === config.colorBleed &&
      preset.vignette === config.vignette
    ) {
      return id;
    }
  }
  return null;
}

/** Applies a named preset, returning a fresh config (never mutates). */
export function applyCrtPreset(preset: CrtPreset): CrtFilterConfig {
  return { ...CRT_PRESETS[preset] };
}

/** Whether every effect is at zero intensity — the cheap "skip the shader
 * entirely" / "skip the overlay div entirely" check both play paths use. */
export function isCrtFilterOff(config: CrtFilterConfig): boolean {
  return (
    config.scanlines === INTENSITY_MIN &&
    config.curvature === INTENSITY_MIN &&
    config.colorBleed === INTENSITY_MIN &&
    config.vignette === INTENSITY_MIN
  );
}

/** Normalizes a 0–100 intensity into the 0–1 range a shader uniform or CSS
 * custom property expects. */
export function toUnit(intensity: number): number {
  return clampIntensity(intensity) / INTENSITY_MAX;
}
