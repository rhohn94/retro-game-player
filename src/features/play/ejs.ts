// EmulatorJS system mapping for the in-page WASM player (v0.15).
//
// Maps a Harmony system key (Game.system) to the EmulatorJS "core" / system key.
// ONLY systems whose WASM core is bundled under public/emulatorjs/cores are
// listed — everything else (heavier or BIOS-gated systems, and the gen-6
// consoles WASM can't handle) falls back to the native external-RetroArch
// launch. This keeps in-page play offline (no runtime CDN core download).
//
// Cartridge systems with no BIOS requirement are the clean WASM set; BIOS-gated
// systems (psx/saturn/3do) are intentionally omitted for now.

/** Harmony system key → EmulatorJS system key, for bundled-core systems only. */
export const EJS_SYSTEM: Readonly<Record<string, string>> = {
  nes: "nes",
};

/**
 * The EmulatorJS system key for a Harmony system, or undefined when the system
 * has no bundled in-page core (caller falls back to the native launch).
 *
 * Uses an own-property check so a system string that collides with an
 * `Object.prototype` key (e.g. "toString", "constructor") never resolves to an
 * inherited member — that would route an unsupported game to in-page play and
 * try to boot a function as a core.
 */
export function inPageSystem(system: string): string | undefined {
  return Object.hasOwn(EJS_SYSTEM, system) ? EJS_SYSTEM[system] : undefined;
}

/** Whether a system can be played inside the Harmony page. */
export function canPlayInPage(system: string): boolean {
  return inPageSystem(system) !== undefined;
}
