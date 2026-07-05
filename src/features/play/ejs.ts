// EmulatorJS system mapping for the in-page WASM player (v0.15; extended by
// v0.24 W241 multi-core coverage and v0.34 W341 handheld coverage —
// in-page-play-design.md §7).
//
// Maps a Retro Game Player system key (Game.system) to the value passed as the player
// page's `?core=` / `EJS_core`. NES uses the EJS system alias "nes" (resolves
// to the *embedded* fceumm core — always available, no acquisition). Every
// other entry is an explicit EmulatorJS core name from the curated on-demand
// catalog (Rust `play/ejs_cores.rs`); whether it can actually boot depends on
// whether that core is installed — callers resolve that via
// `list_inpage_cores` (see PlaySwitch). Systems absent here fall back to the
// external RetroArch launch — Wii is deliberately absent (no EJS core is
// curated for it; Dolphin is external-launch only).
//
// All listed cores are single-threaded (no SharedArrayBuffer/COOP/COEP).
// BIOS-gated exceptions: ps1 runs pcsx_rearmed's HLE BIOS (most titles boot,
// some need a real BIOS — out of scope; single-file images only).

/** Retro Game Player system key → `EJS_core` value, for in-page-capable systems only. */
export const EJS_SYSTEM: Readonly<Record<string, string>> = {
  nes: "nes", // embedded fceumm (v0.15)
  snes: "snes9x",
  genesis: "genesis_plus_gx",
  mastersystem: "genesis_plus_gx",
  n64: "mupen64plus_next",
  ps1: "pcsx_rearmed",
  atari2600: "stella2014",
  pcengine: "mednafen_pce",
  gb: "gambatte",
  gbc: "gambatte",
  gba: "mgba",
};

/**
 * The `EJS_core` value for a Retro Game Player system, or undefined when the system has
 * no in-page core at all (caller falls back to the native launch).
 *
 * Uses an own-property check so a system string that collides with an
 * `Object.prototype` key (e.g. "toString", "constructor") never resolves to an
 * inherited member — that would route an unsupported game to in-page play and
 * try to boot a function as a core.
 */
export function inPageSystem(system: string): string | undefined {
  return Object.hasOwn(EJS_SYSTEM, system) ? EJS_SYSTEM[system] : undefined;
}

/** Whether a system has an in-page path (embedded or on-demand core). */
export function canPlayInPage(system: string): boolean {
  return inPageSystem(system) !== undefined;
}

/** Whether `system`'s in-page core ships embedded (needs no acquisition). */
export function isEmbeddedInPage(system: string): boolean {
  return system === "nes";
}
