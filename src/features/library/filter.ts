// Pure library-filtering logic (v0.6 "Lens", v0.31 W315 "Desktop" facet) —
// kept React-free so it is unit testable. The LibraryPage owns the criteria
// state and renders LibraryFilters; this module computes the available facet
// values and applies the filter.
//
// Facets: console (system) — now including a synthetic "Desktop" tab for
// non-retro rows (v0.31 W310: they carry no `system`) — release year,
// developer, publisher, plus a free-text query that matches the title OR any
// popular alias. Filters combine with AND. A facet only has options when the
// loaded games actually carry values for it (year/developer/publisher are
// nullable until enrichment populates them), so the UI can hide empty facets
// and degrade gracefully.

import type { Game } from "../../ipc/commands";
import { isNonRetro } from "./sourceBadge";

/** The "no console filter" sentinel (also the default tab label). */
export const ALL_SYSTEMS = "All";

/** The synthetic system-tab value selecting every non-retro ("Frontier")
 * row — Steam/App/Manual games have no `system` (v0.31 W310), so they need a
 * dedicated facet value rather than a real console id (non-retro-library-
 * design.md §UI: "a Desktop library filter/section for non-retro games"). */
export const DESKTOP_SYSTEM = "Desktop";

export interface FilterCriteria {
  /** Free-text; matches the title or any alias (case-insensitive substring). */
  query: string;
  /** A system id, ALL_SYSTEMS for no console constraint, or DESKTOP_SYSTEM to
   * show only non-retro rows. */
  system: string;
  /** Exact release year, or null for no year constraint. */
  year: number | null;
  /** Exact developer, or null. */
  developer: string | null;
  /** Exact publisher, or null. */
  publisher: string | null;
}

export const EMPTY_CRITERIA: FilterCriteria = {
  query: "",
  system: ALL_SYSTEMS,
  year: null,
  developer: null,
  publisher: null,
};

/** Distinct, sorted values available for each facet across `games`. */
export interface Facets {
  systems: string[];
  years: number[];
  developers: string[];
  publishers: string[];
  /** True when at least one non-retro row is present, so the UI only shows
   * the "Desktop" tab when it would ever match a game (v0.31 W315). */
  hasDesktop: boolean;
}

/** Compute the selectable values for each facet (only values actually present). */
export function facetValues(games: Game[]): Facets {
  const systems = new Set<string>();
  const years = new Set<number>();
  const developers = new Set<string>();
  const publishers = new Set<string>();
  let hasDesktop = false;
  for (const g of games) {
    if (g.system) systems.add(g.system);
    if (isNonRetro(g)) hasDesktop = true;
    if (g.year != null) years.add(g.year);
    if (g.developer) developers.add(g.developer);
    if (g.publisher) publishers.add(g.publisher);
  }
  return {
    systems: [...systems].sort(),
    years: [...years].sort((a, b) => b - a), // newest first
    developers: [...developers].sort(),
    publishers: [...publishers].sort(),
    hasDesktop,
  };
}

/** Apply the criteria to `games` (AND across active facets). */
export function filterGames(games: Game[], c: FilterCriteria): Game[] {
  const q = c.query.trim().toLowerCase();
  return games.filter((g) => {
    if (c.system === DESKTOP_SYSTEM) {
      if (!isNonRetro(g)) return false;
    } else if (c.system !== ALL_SYSTEMS && g.system !== c.system) {
      return false;
    }
    if (c.year != null && g.year !== c.year) return false;
    if (c.developer != null && g.developer !== c.developer) return false;
    if (c.publisher != null && g.publisher !== c.publisher) return false;
    if (q) {
      const haystack = [g.cleanName, ...(g.aliases ?? [])].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Whether any facet constraint is active (used to show a "clear" affordance). */
export function hasActiveFilters(c: FilterCriteria): boolean {
  return (
    c.query.trim() !== "" ||
    c.system !== ALL_SYSTEMS ||
    c.year != null ||
    c.developer != null ||
    c.publisher != null
  );
}
