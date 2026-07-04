// CRT filter config IPC (v0.29 W280, crt-filter-design.md): one shared
// per-effect intensity + preset shape persisted backend-side (AppConfig) so
// both play paths (native WebGL2 shader, EJS CSS approximation) read/write
// the exact same config. Mirrors the shape of ipc/player-prefs.ts.

import { invoke } from "./invoke";

/** The four named presets crt-filter-design.md defines. `null` means the
 * current intensities don't exactly match any preset (a free-tweaked mix). */
export type CrtPreset = "off" | "classic" | "arcade" | "sharp";

/** Mirrors the Rust `CrtFilterDto`. Every intensity is [0, 100]. */
export interface CrtFilterConfig {
  scanlines: number;
  curvature: number;
  colorBleed: number;
  vignette: number;
  preset: CrtPreset | null;
}

/** The current CRT filter config (defaults to the `off` preset). */
export function getCrtFilter(): Promise<CrtFilterConfig> {
  return invoke<CrtFilterConfig>("get_crt_filter");
}

/** Persists the CRT filter config (intensities clamped backend-side). */
export function setCrtFilter(config: CrtFilterConfig): Promise<void> {
  return invoke<void>("set_crt_filter", { config });
}
