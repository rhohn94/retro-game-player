// TV system labels + recency ordering (v0.26 W261, tv-mode-design.md §Design
// "Shelves": "per-console rails … ordered by most-recently-played system
// first"). Pure + framework-free so the label lookup and the recency sort are
// unit-testable without a DOM or IPC.
//
// A dedicated, COMPLETE label table lives here rather than reusing the partial
// maps in `play/inPageAvailability.ts` (missing `nes`) or `cores/SystemList.tsx`
// (only nes/snes/n64): the TV home shows a rail per system that has games, so
// it needs every catalog key to read as a proper console name at 10 feet, not
// a raw lowercase key. This is the authoritative TV-surface console-name source.

import type { Game } from "../../ipc/library";

/** Human-readable console name per system key, covering the full curated
 * catalog (system_map.rs). A missing key falls back to the upper-cased key so
 * a brand-new system still renders a legible rail label. */
const TV_SYSTEM_LABELS: Readonly<Record<string, string>> = {
  nes: "NES",
  snes: "SNES",
  n64: "Nintendo 64",
  gamecube: "GameCube",
  atari2600: "Atari 2600",
  mastersystem: "Master System",
  genesis: "Genesis",
  pcengine: "PC Engine",
  neogeo: "Neo Geo",
  ps1: "PlayStation",
  saturn: "Saturn",
  dreamcast: "Dreamcast",
};

/**
 * A human-readable console name for a system key, for TV rail labels. Falls
 * back to the upper-cased raw key (e.g. an unmapped "gb" → "GB") so every
 * system that has games gets a legible label.
 */
export function tvSystemLabel(system: string): string {
  if (Object.hasOwn(TV_SYSTEM_LABELS, system)) return TV_SYSTEM_LABELS[system];
  return system.toUpperCase();
}

/**
 * The distinct system keys present in `games`, ordered by the most recent
 * play in each system first (a system whose most-recently-played game beats
 * another's leads), with never-played systems trailing in first-seen order.
 *
 * Recency is read from each game's `lastPlayedAt` (unix seconds, or null when
 * never played). Ties and all-null systems fall back to stable insertion order
 * so the ordering is deterministic for a given library — important for the
 * headless smoke and for tests.
 */
export function orderSystemsByRecency(games: readonly Game[]): string[] {
  // Track, per system, its best (max) lastPlayedAt and the order it first
  // appeared, so we can sort played-first then stable-by-appearance.
  const bestPlayed = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  games.forEach((game, index) => {
    // Non-ROM games (v0.31 W310) have no `system` and contribute no console
    // rail here — a "Desktop" rail treatment lands in W315.
    if (!game.system) return;
    const system = game.system;
    if (!firstSeen.has(system)) firstSeen.set(system, index);
    const played = game.lastPlayedAt ?? 0;
    const prev = bestPlayed.get(system) ?? 0;
    if (played > prev) bestPlayed.set(system, played);
  });

  return [...firstSeen.keys()].sort((a, b) => {
    const pa = bestPlayed.get(a) ?? 0;
    const pb = bestPlayed.get(b) ?? 0;
    if (pb !== pa) return pb - pa; // more-recent play first
    return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0); // stable
  });
}
