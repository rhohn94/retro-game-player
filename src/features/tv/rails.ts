// TV rail composition (v0.26 W261, tv-mode-design.md §Design "Shelves"; v0.31
// W315 adds the trailing "Desktop" rail; v0.37 W373 adds one rail per
// non-empty user collection, right after Favorites — collections-design.md
// §Design: "extend buildRails()/useTvLibrary with one rail per non-empty
// collection after Favorites, capped at the existing rail-count
// conventions"). Pure + framework-free: given the library's games plus the
// recently-played / favorites / collections slices, produce the ordered list
// of rails the TV home renders — Continue playing, Favorites, one rail per
// non-empty collection (in the backend's `list_collections` order),
// Recently added, one rail per system that has games (most-recently-played
// system first), then a single "Desktop" rail collecting every non-retro
// (Steam/App/Manual, v0.31 W310) row so they stay launchable from the TV flow.
// Empty rails are dropped so the home never shows a labelled-but-empty shelf.
// Unit-tested without a DOM.

import type { Game } from "../../ipc/library";
import type { CollectionWithCount } from "../../ipc/collections";
import { isNonRetro } from "../library/sourceBadge";
import { orderSystemsByRecency, tvSystemLabel } from "./systems";

/** A stable, unique rail identifier. Namespaced so a per-system rail id can
 * never collide with a built-in rail id, and so a tile's focus id
 * (`${railId}:${gameId}`) is globally unique across the home. */
export type RailId = string;

/** One horizontal cover-art shelf: a stable id, a display label, and its games
 * in display order. Always non-empty (empty rails are dropped by `buildRails`). */
export interface TvRailModel {
  id: RailId;
  label: string;
  games: Game[];
}

/** Inputs to {@link buildRails}: the full library plus the two server-ordered
 * slices from the play-stats IPC (already limited + ordered by the backend),
 * plus the collections slice (v0.37 W373). */
export interface RailSources {
  /** Every game in the library (drives Recently added + the per-system rails). */
  games: readonly Game[];
  /** `list_recently_played` result — most-recently-played first. */
  recentlyPlayed: readonly Game[];
  /** `list_favorites` result. */
  favorites: readonly Game[];
  /** `list_collections` result (every collection with its member count) —
   * only collections with `gameCount > 0` get a rail (v0.37 W373). Each
   * collection's member games are supplied via `collectionGames`. Defaults to
   * empty so existing callers (and tests) that predate collections keep
   * working unchanged. */
  collections?: readonly CollectionWithCount[];
  /** Member games per collection id, keyed by `Collection.id` — the result of
   * `listGamesByCollection` for each collection in `collections` (v0.37
   * W373). A collection absent from this map (e.g. its member fetch is still
   * in flight) is treated as having no games yet, so its rail is simply
   * omitted until the data arrives rather than showing stale/wrong tiles. */
  collectionGames?: ReadonlyMap<number, readonly Game[]>;
}

/** Rail ids for the three built-in rails, exported so components + tests refer
 * to them by name rather than re-typing the string literal. */
export const RAIL_CONTINUE: RailId = "rail:continue";
export const RAIL_FAVORITES: RailId = "rail:favorites";
export const RAIL_RECENT: RailId = "rail:recent";
/** The single rail collecting every non-retro (Steam/App/Manual) row (v0.31
 * W315) — trails the per-system rails so it reads as an addition. */
export const RAIL_DESKTOP: RailId = "rail:desktop";
/** Per-system rail id for a system key. */
export function systemRailId(system: string): RailId {
  return `rail:system:${system}`;
}
/** Per-collection rail id for a collection id (v0.37 W373). */
export function collectionRailId(collectionId: number): RailId {
  return `rail:collection:${collectionId}`;
}

/** How many "recently added" games the dedicated rail shows — the newest slice,
 * so the rail stays a curated shelf rather than the whole library repeated. */
export const RECENTLY_ADDED_LIMIT = 24;

/** How many collection rails the TV home shows at most (v0.37 W373 —
 * collections-design.md §Design: "capped at the existing rail-count
 * conventions"). Mirrors `RECENTLY_ADDED_LIMIT`'s role of keeping a shelf from
 * growing unbounded as the user creates more collections over time. */
export const MAX_COLLECTION_RAILS = 24;

/**
 * Build the ordered, non-empty rail list for the TV home.
 *
 * Order (tv-mode-design.md §Design "Shelves"; v0.37 W373 collections-design.md
 * §Design):
 *   1. Continue playing  — `recentlyPlayed` (backend-ordered).
 *   2. Favorites         — `favorites`.
 *   3. One rail per non-empty collection, in `list_collections` order,
 *      capped at `MAX_COLLECTION_RAILS`.
 *   4. Recently added    — `games` by `addedAt` desc, newest `RECENTLY_ADDED_LIMIT`.
 *   5. One rail per system that has games, most-recently-played system first.
 *   6. Desktop           — every non-retro (Steam/App/Manual, v0.31 W310) row,
 *      newest `addedAt` first, trailing every console rail (v0.31 W315).
 *
 * Any rail with no games is omitted entirely (no labelled-empty shelves).
 */
export function buildRails(sources: RailSources): TvRailModel[] {
  const { games, recentlyPlayed, favorites, collections = [], collectionGames } = sources;
  const rails: TvRailModel[] = [];

  if (recentlyPlayed.length > 0) {
    rails.push({ id: RAIL_CONTINUE, label: "Continue playing", games: [...recentlyPlayed] });
  }
  if (favorites.length > 0) {
    rails.push({ id: RAIL_FAVORITES, label: "Favorites", games: [...favorites] });
  }

  if (collectionGames) {
    let emitted = 0;
    for (const collection of collections) {
      if (emitted >= MAX_COLLECTION_RAILS) break;
      const members = collectionGames.get(collection.id);
      if (!members || members.length === 0) continue;
      rails.push({
        id: collectionRailId(collection.id),
        label: collection.name,
        games: [...members],
      });
      emitted += 1;
    }
  }

  const recentlyAdded = [...games]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, RECENTLY_ADDED_LIMIT);
  if (recentlyAdded.length > 0) {
    rails.push({ id: RAIL_RECENT, label: "Recently added", games: recentlyAdded });
  }

  // Group games by system, then emit one rail per system in recency order.
  // Non-ROM games (v0.31 W310) have no `system` and are excluded from the
  // per-system rails entirely — they get their own "Desktop" rail below.
  const bySystem = new Map<string, Game[]>();
  for (const game of games) {
    if (!game.system) continue;
    const list = bySystem.get(game.system);
    if (list) list.push(game);
    else bySystem.set(game.system, [game]);
  }
  for (const system of orderSystemsByRecency(games)) {
    const systemGames = bySystem.get(system);
    if (systemGames && systemGames.length > 0) {
      rails.push({
        id: systemRailId(system),
        label: tvSystemLabel(system),
        games: systemGames,
      });
    }
  }

  // The Desktop rail (v0.31 W315): every non-retro row, newest first, so
  // Steam/App/Manual titles stay browsable + launchable from the TV flow
  // even though they have no console rail of their own.
  const desktopGames = games.filter(isNonRetro).sort((a, b) => b.addedAt - a.addedAt);
  if (desktopGames.length > 0) {
    rails.push({ id: RAIL_DESKTOP, label: "Desktop", games: desktopGames });
  }

  return rails;
}

/** A tile's globally-unique focus id within the home: rail id + game id. The
 * same game can appear in several rails (e.g. Continue playing AND its system
 * rail), so the id must be scoped by rail, not by game alone. */
export function tileFocusId(railId: RailId, gameId: number): string {
  return `${railId}:${gameId}`;
}

/** The number of tiles at/above which a rail switches to windowed rendering
 * (tv-mode-design.md: "windowed rendering for rails ≥50 items"). Below this a
 * rail renders all its tiles (cheap; keeps the simple path simple). */
export const WINDOW_THRESHOLD = 50;

/** A windowed slice of a rail's tiles: the visible items plus the absolute
 * index the slice starts at (so callers can spacer-pad the leading gap and
 * render each tile at its true index for focus-id stability). */
export interface RailWindow<T> {
  /** The visible items. */
  items: T[];
  /** Absolute index of `items[0]` within the full list. */
  start: number;
  /** Total length of the full list (for trailing-spacer sizing). */
  total: number;
}

/**
 * Compute the visible window of a rail's items around `focusedIndex`.
 *
 * For lists shorter than {@link WINDOW_THRESHOLD} the whole list is returned
 * (start 0). For longer lists a `radius`-wide band on each side of the focused
 * tile is returned, clamped to the list bounds — enough off-screen tiles that
 * a left/right move always lands on an already-mounted neighbour, without
 * mounting hundreds of off-screen `<img>` tiles.
 *
 * `focusedIndex` outside the list (e.g. -1 when the rail isn't focused) is
 * treated as 0 so an unfocused long rail still shows its head.
 */
export function railWindow<T>(
  items: readonly T[],
  focusedIndex: number,
  radius: number,
): RailWindow<T> {
  const total = items.length;
  if (total < WINDOW_THRESHOLD) {
    return { items: [...items], start: 0, total };
  }
  const safeIndex = Number.isFinite(focusedIndex) && focusedIndex >= 0 ? focusedIndex : 0;
  const start = Math.max(0, Math.min(safeIndex - radius, total - (radius * 2 + 1)));
  const end = Math.min(total, start + radius * 2 + 1);
  return { items: items.slice(start, end), start: Math.max(0, start), total };
}
