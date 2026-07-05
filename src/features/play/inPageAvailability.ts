// Pure resolution of a system's in-page play state (v0.24 W241) — framework-
// free so the three-outcome switch (ready / needs-core / none) is
// unit-testable without a DOM. See in-page-play-design.md §7.

import type { InPageCore } from "../../ipc/inpage-cores";
import { inPageSystem, isEmbeddedInPage } from "./ejs";

export type InPageAvailability =
  /** No in-page core exists for the system (RetroArch launch only). */
  | { kind: "none" }
  /** Bootable now — embedded (NES) or an installed on-demand core. */
  | { kind: "ready"; ejsCore: string }
  /** A curated core covers it but isn't cached yet. */
  | { kind: "needs-core"; ejsCore: string; sizeBytes: number };

/**
 * Resolves `system` against the mapping and the on-demand catalog state.
 * `cores` is the `list_inpage_cores` result; `null` (not yet loaded / IPC
 * failed) degrades non-embedded systems to `needs-core` with an unknown
 * size — never a false "ready".
 */
export function inPageAvailability(
  system: string,
  cores: InPageCore[] | null,
): InPageAvailability {
  const ejsCore = inPageSystem(system);
  if (!ejsCore) return { kind: "none" };
  if (isEmbeddedInPage(system)) return { kind: "ready", ejsCore };
  const entry = cores?.find((c) => c.core === ejsCore);
  if (entry?.installed) return { kind: "ready", ejsCore };
  return { kind: "needs-core", ejsCore, sizeBytes: entry?.sizeBytes ?? 0 };
}

/** "1.1 MB"-style size label; "a small download" when the size is unknown. */
export function describeCoreSize(sizeBytes: number): string {
  if (sizeBytes <= 0) return "a small download";
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Display names for the get-core panel copy, keyed by Retro Game Player system. */
const SYSTEM_LABELS: Readonly<Record<string, string>> = {
  snes: "SNES",
  genesis: "Genesis",
  mastersystem: "Master System",
  n64: "Nintendo 64",
  ps1: "PlayStation",
  atari2600: "Atari 2600",
  pcengine: "PC Engine",
  gamecube: "GameCube",
  wii: "Wii",
};

/** A human-readable console name for `system` (falls back to the key). */
export function systemLabel(system: string): string {
  return Object.hasOwn(SYSTEM_LABELS, system) ? SYSTEM_LABELS[system] : system;
}

/** Display name of the emulator a `kind: "none"` system's ROMs actually run
 * under inside RetroArch, keyed by Retro Game Player system (v0.34 W346 —
 * native-emulation-design.md §HW-render GC/Wii note: dolphin-libretro stays
 * external-launch-only, so the detail page names it honestly instead of the
 * generic "RetroArch" wording). Absent for a system with no single curated
 * emulator to name. */
const EXTERNAL_EMULATOR_LABELS: Readonly<Record<string, string>> = {
  gamecube: "Dolphin",
  wii: "Dolphin",
};

/**
 * Honest "plays externally" copy for a `kind: "none"` system (no in-page or
 * native path exists at all — RetroArch launch only, `ExternalOnlyNotice`'s
 * caller). Names the actual emulator RetroArch loads when one is curated
 * (e.g. "Dolphin" for GameCube/Wii) rather than leaving the console
 * unexplained on the detail page.
 */
export function externalOnlyMessage(system: string): string {
  const label = systemLabel(system);
  const emulator = Object.hasOwn(EXTERNAL_EMULATOR_LABELS, system)
    ? EXTERNAL_EMULATOR_LABELS[system]
    : undefined;
  return emulator
    ? `${label} titles launch in RetroArch (${emulator} core) — a separate window opens to play.`
    : `${label} titles launch in RetroArch — a separate window opens to play.`;
}
