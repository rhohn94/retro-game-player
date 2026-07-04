// sourceBadge — pure helpers for the non-retro "Frontier" source badge and
// launch-affordance copy (v0.31 W315, non-retro-library-design.md §UI). A ROM
// row keeps its existing console badge (unchanged); a non-`"rom"` row shows a
// source badge (Steam / App / Manual) instead — there is no console to show
// (`Game.system` is null for those rows, W310). Kept framework-free so the
// badge/label mapping is unit-testable without a DOM.

import type { Game, GameSource } from "../../ipc/library";

/** Human-readable badge label for a game's source, covering every
 * `GameSource` value. `"rom"` is included for completeness even though ROM
 * rows render their console badge instead of calling this. */
const SOURCE_BADGE_LABELS: Readonly<Record<GameSource, string>> = {
  rom: "ROM",
  steam: "Steam",
  app: "App",
  manual: "Manual",
};

/** Whether a game is a first-class non-retro ("Frontier") library row — i.e.
 * it launches externally via a launch descriptor rather than through a ROM +
 * emulator core (v0.31 W310). Used to gate console-only UI (system badges,
 * emulator affordances, per-system TV rails) off non-retro rows. */
export function isNonRetro(game: Pick<Game, "source">): boolean {
  return game.source !== "rom";
}

/** The badge label for `game`'s source. Callers typically only call this for
 * non-retro rows (`isNonRetro`); ROM rows should keep showing their console
 * badge instead. */
export function sourceBadgeLabel(source: GameSource): string {
  return SOURCE_BADGE_LABELS[source];
}

/** Human-readable "launches via" copy for a non-retro row's detail page
 * (non-retro-library-design.md §UI: "Launches via Steam / Launches via
 * macOS"). ROM rows have no meaningful answer here — callers should not show
 * this copy for them. */
export function launchesViaLabel(source: GameSource): string {
  switch (source) {
    case "steam":
      return "Launches via Steam";
    case "app":
    case "manual":
      return "Launches via macOS";
    case "rom":
      return "Launches via RetroArch";
  }
}
