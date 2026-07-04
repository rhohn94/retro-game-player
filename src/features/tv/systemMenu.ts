// TvSystemMenu's data model + pure list-navigation logic (v0.28 W278,
// tv-mode-design.md §v0.28 → W278). Kept separate from the component (pure,
// framework-free) mirroring railNav.ts's split: the menu's up/down wrap
// behaviour and destination list are independently unit-testable without a
// DOM or the gamepad loop.

/** One selectable row in the TV system menu. `"home"` returns to the TV home
 * (both from the menu's own "TV Home" entry and structurally reused by the
 * embedded-screen back-to-home contract); `"exit"` leaves TV mode entirely;
 * every other id is a HARMONY_ROUTES path rendered inside the TvShell outlet. */
export type TvMenuDestination =
  | { kind: "home" }
  | { kind: "exit" }
  | { kind: "route"; path: string };

/** One row as rendered in the menu list. */
export interface TvMenuItem {
  /** Stable id for focus/selection tracking. */
  id: string;
  /** The label shown in the panel. */
  label: string;
  /** What selecting this row does. */
  destination: TvMenuDestination;
}

// The fixed menu contents (tv-mode-design.md §v0.28 → W278 "Menu"): TV Home,
// then every primary HARMONY_ROUTES destination the user can browse to, then
// Exit TV mode. Console detail / game detail are deep links only (no nav
// entry), matching the desktop sidebar's own `navLabel`-gated list — the menu
// intentionally mirrors that same "primary destinations" set rather than
// duplicating every route.
export const TV_MENU_ITEMS: readonly TvMenuItem[] = [
  { id: "home", label: "TV Home", destination: { kind: "home" } },
  { id: "consoles", label: "Consoles", destination: { kind: "route", path: "/consoles" } },
  { id: "search", label: "Search", destination: { kind: "route", path: "/search" } },
  { id: "cores", label: "Cores", destination: { kind: "route", path: "/cores" } },
  { id: "settings", label: "Settings", destination: { kind: "route", path: "/settings" } },
  { id: "exit", label: "Exit TV mode", destination: { kind: "exit" } },
] as const;

/** Clamp an index into the menu's bounds (defensive — the list is fixed-size,
 * but keeps this symmetric with railNav's clamping helpers). */
function clampIndex(index: number): number {
  return Math.max(0, Math.min(index, TV_MENU_ITEMS.length - 1));
}

/**
 * Resolve the next selected index for a nav_up/nav_down press. No wraparound
 * (matches railNav's left/right end-stop behaviour: the edge row stays
 * selected rather than cycling) — a leanback menu with wraparound risks
 * disorienting a user who over-shoots past the last/first row.
 */
export function nextMenuIndex(current: number, direction: "up" | "down"): number {
  const delta = direction === "up" ? -1 : 1;
  return clampIndex(current + delta);
}
