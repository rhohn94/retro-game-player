// Pure library-filtering logic (v0.6 "Lens") — kept React-free so it is unit
// testable. The LibraryPage owns the criteria state and renders LibraryFilters;
// this module computes the available facet values and applies the filter.
//
// Facets: console (system), release year, developer, publisher, plus a free-text
// query that matches the title OR any popular alias. Filters combine with AND.
// A facet only has options when the loaded games actually carry values for it
// (year/developer/publisher are nullable until enrichment populates them), so
// the UI can hide empty facets and degrade gracefully.

import type { Game } from "../../ipc/commands";

/** The "no console filter" sentinel (also the default tab label). */
export const ALL_SYSTEMS = "All";

export interface FilterCriteria {
  /** Free-text; matches the title or any alias (case-insensitive substring). */
  query: string;
  /** A system id, or ALL_SYSTEMS for no console constraint. */
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
}

/** Compute the selectable values for each facet (only values actually present). */
export function facetValues(games: Game[]): Facets {
  const systems = new Set<string>();
  const years = new Set<number>();
  const developers = new Set<string>();
  const publishers = new Set<string>();
  for (const g of games) {
    if (g.system) systems.add(g.system);
    if (g.year != null) years.add(g.year);
    if (g.developer) developers.add(g.developer);
    if (g.publisher) publishers.add(g.publisher);
  }
  return {
    systems: [...systems].sort(),
    years: [...years].sort((a, b) => b - a), // newest first
    developers: [...developers].sort(),
    publishers: [...publishers].sort(),
  };
}

/** Apply the criteria to `games` (AND across active facets). */
export function filterGames(games: Game[], c: FilterCriteria): Game[] {
  const q = c.query.trim().toLowerCase();
  return games.filter((g) => {
    if (c.system !== ALL_SYSTEMS && g.system !== c.system) return false;
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
