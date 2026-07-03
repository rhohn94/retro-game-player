// Rail-aware focus navigation (v0.26 W261, tv-mode-design.md §Design "Shelves":
// "left/right moves within a rail, up/down across rails, with per-rail focus
// memory"). Pure + framework-free so the traversal logic — which tile a
// left/right/up/down press lands on, including the hero row and per-rail focus
// memory — is fully unit-testable without a DOM or the gamepad loop.
//
// The base spatial engine (controller/spatial.ts) is a geometric nearest-
// neighbour that has no notion of "rail" or "remembered column". TV home layers
// this explicit row/column model over it: rows are [hero, rail0, rail1, …] and a
// vertical move remembers the column (tile index) you left a rail at, so
// returning to that rail restores the same tile rather than snapping to column 0.

import type { TvRailModel } from "./rails";
import { tileFocusId } from "./rails";

/** The hero play affordance participates as the top focus row (tv-mode-design.md:
 * "hero participates as the top focus row"). Its focus id is a fixed constant. */
export const HERO_FOCUS_ID = "tv-hero:play";

/** A vertical/horizontal move direction the home understands. */
export type RailNavDirection = "up" | "down" | "left" | "right";

/** Per-rail memory of the last-focused tile INDEX (column) within each rail,
 * keyed by rail id. A plain object so it is trivially serialisable + testable. */
export type RailFocusMemory = Readonly<Record<string, number>>;

/** Locate a focus id within the rail model: which rail (index) and which tile
 * (column) it is, or null when the id isn't a tile (e.g. the hero, or stale). */
export function locateTile(
  rails: readonly TvRailModel[],
  focusId: string | null,
): { railIndex: number; tileIndex: number } | null {
  if (!focusId) return null;
  for (let railIndex = 0; railIndex < rails.length; railIndex++) {
    const rail = rails[railIndex];
    for (let tileIndex = 0; tileIndex < rail.games.length; tileIndex++) {
      if (tileFocusId(rail.id, rail.games[tileIndex].id) === focusId) {
        return { railIndex, tileIndex };
      }
    }
  }
  return null;
}

/** The focus id of a rail's tile at `tileIndex`, clamped into the rail's
 * bounds (so a remembered column that outlived a rail shrink still resolves). */
function tileIdAt(rail: TvRailModel, tileIndex: number): string {
  const clamped = Math.max(0, Math.min(tileIndex, rail.games.length - 1));
  return tileFocusId(rail.id, rail.games[clamped].id);
}

/** The focus id to land on when entering `rail` from a vertical move: the
 * remembered column if present, else the rail's first tile. */
function enterRail(rail: TvRailModel, memory: RailFocusMemory): string {
  const remembered = memory[rail.id];
  return tileIdAt(rail, remembered ?? 0);
}

/**
 * Resolve the next focus id for a nav press from `currentId`, given the rail
 * model and the current per-rail focus memory.
 *
 * Model (rows top→bottom): [hero, rail 0, rail 1, …].
 *   - up/down move between rows. From the hero, `down` enters rail 0 (at its
 *     remembered column); `up` from rail 0 goes to the hero. Entering a rail
 *     restores its remembered column (per-rail focus memory).
 *   - left/right move within the current rail, clamped at the ends (no wrap —
 *     the edge tile stays focused, which W262 will pair with an edge-scroll).
 *   - the hero has a single affordance, so left/right on it are no-ops.
 *
 * Returns the same `currentId` when a move has nowhere to go (an end-stop), so
 * the caller can treat "no change" uniformly. Returns null only when there is
 * nothing focusable at all (no rails and not on the hero).
 */
export function resolveRailNav(
  rails: readonly TvRailModel[],
  currentId: string | null,
  direction: RailNavDirection,
  memory: RailFocusMemory,
): string | null {
  const onHero = currentId === HERO_FOCUS_ID;

  if (onHero) {
    if (direction === "down") {
      return rails.length > 0 ? enterRail(rails[0], memory) : HERO_FOCUS_ID;
    }
    // up / left / right from the single hero affordance stay put.
    return HERO_FOCUS_ID;
  }

  const loc = locateTile(rails, currentId);
  if (!loc) {
    // Unknown/stale focus: seed onto the hero if there is one, else rail 0.
    if (rails.length === 0) return null;
    return HERO_FOCUS_ID;
  }

  const { railIndex, tileIndex } = loc;
  const rail = rails[railIndex];

  switch (direction) {
    case "left": {
      const next = tileIndex - 1;
      return next >= 0 ? tileFocusId(rail.id, rail.games[next].id) : currentId;
    }
    case "right": {
      const next = tileIndex + 1;
      return next < rail.games.length
        ? tileFocusId(rail.id, rail.games[next].id)
        : currentId;
    }
    case "up": {
      // Leaving a rail upward: rail above, or the hero above rail 0.
      if (railIndex === 0) return HERO_FOCUS_ID;
      const above = rails[railIndex - 1];
      const remembered = memory[above.id];
      // Prefer the remembered column; else align to the current column so a
      // vertical sweep feels column-stable when no memory exists yet.
      return tileIdAt(above, remembered ?? tileIndex);
    }
    case "down": {
      if (railIndex >= rails.length - 1) return currentId; // last rail: end-stop
      const below = rails[railIndex + 1];
      const remembered = memory[below.id];
      return tileIdAt(below, remembered ?? tileIndex);
    }
  }
}

/**
 * Fold a newly-focused tile into the per-rail focus memory: record the column
 * (tile index) the id sits at, in its rail. A non-tile id (the hero, or a stale
 * id) leaves memory unchanged. Returns a NEW memory object (never mutates) so it
 * slots cleanly into React state / a ref update.
 */
export function rememberFocus(
  rails: readonly TvRailModel[],
  memory: RailFocusMemory,
  focusId: string | null,
): RailFocusMemory {
  const loc = locateTile(rails, focusId);
  if (!loc) return memory;
  const railId = rails[loc.railIndex].id;
  if (memory[railId] === loc.tileIndex) return memory; // no-op: identical
  return { ...memory, [railId]: loc.tileIndex };
}
