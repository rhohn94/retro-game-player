// useTvLibrary — loads the data sources the TV home shelves need and
// composes them into the ordered rail model (v0.26 W261; v0.37 W373 adds the
// collections slice). Keeps all IPC + the pure `buildRails` composition
// behind one hook so `TvHome` stays a layout component. Degrades to whatever
// loaded: a failed favorites/recent/collections call just drops that rail (or
// those rails), never blanks the home.

import { useState } from "react";
import { listGames } from "../../ipc/library";
import { listRecentlyPlayed, listFavorites } from "../../ipc/play-stats";
import type { Game } from "../../ipc/library";
import { listCollections, listGamesByCollection, type CollectionWithCount } from "../../ipc/collections";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { buildRails, MAX_COLLECTION_RAILS, type TvRailModel } from "./rails";
import { swallow } from "../../ipc/swallow";

/** How many recently-played / favorite rows to request from the backend. The
 * rails are art shelves, not full lists — a generous cap keeps a long history
 * from making a single rail unbounded while still feeling complete. */
const RAIL_QUERY_LIMIT = 60;

/**
 * Load every non-empty collection's member games, capped at
 * `MAX_COLLECTION_RAILS` collections (matches `buildRails`'s own cap, so this
 * never fetches members for a collection that could never get a rail
 * anyway). A single collection's failed fetch degrades to an empty member
 * list — one bad collection never blanks the others.
 */
async function loadCollectionGames(
  collections: readonly CollectionWithCount[],
): Promise<ReadonlyMap<number, readonly Game[]>> {
  const candidates = collections.filter((c) => c.gameCount > 0).slice(0, MAX_COLLECTION_RAILS);
  const entries = await Promise.all(
    candidates.map(async (c): Promise<[number, readonly Game[]]> => {
      try {
        return [c.id, await listGamesByCollection(c.id)];
      } catch (err) {
        swallow(err, "useTvLibrary.listGamesByCollection");
        return [c.id, []];
      }
    }),
  );
  return new Map(entries);
}

/** The TV library load result: the composed rails plus a coarse loading flag
 * so the home can show its own settle state before the first paint. */
export interface TvLibrary {
  /** Ordered, non-empty rails (Continue playing / Favorites / Recently added /
   * per-system). Empty array until the first load resolves. */
  rails: TvRailModel[];
  /** True until the initial games load resolves (success OR failure). */
  loading: boolean;
}

/**
 * Load the library + play-stats + collections slices and build the TV home's
 * rail model.
 *
 * The top-level IPC calls run concurrently; `list_games` is the spine (its
 * failure yields an empty home), while a failed `list_recently_played` /
 * `list_favorites` / `list_collections` simply degrades to an empty slice so
 * that one rail (or set of rails) is dropped rather than the whole screen
 * erroring — art, history, and collections are enhancements, never
 * load-bearing. Collection MEMBER games are fetched only after
 * `list_collections` resolves (each collection's own id is the fetch key), so
 * they run as a second wave rather than blocking the spine.
 */
export function useTvLibrary(): TvLibrary {
  const [rails, setRails] = useState<TvRailModel[]>([]);
  const [loading, setLoading] = useState(true);

  useCancellableEffect((isCancelled) => {
    setLoading(true);
    void (async () => {
      // Each slice resolves to [] on failure so one bad call can't blank the
      // home; games is awaited as the spine.
      const [games, recentlyPlayed, favorites, collections] = await Promise.all([
        listGames().catch((err: unknown) => {
          swallow(err, "useTvLibrary.listGames");
          return [] as Game[];
        }),
        listRecentlyPlayed(RAIL_QUERY_LIMIT).catch((err: unknown) => {
          swallow(err, "useTvLibrary.listRecentlyPlayed");
          return [] as Game[];
        }),
        listFavorites(RAIL_QUERY_LIMIT).catch((err: unknown) => {
          swallow(err, "useTvLibrary.listFavorites");
          return [] as Game[];
        }),
        listCollections().catch((err: unknown) => {
          swallow(err, "useTvLibrary.listCollections");
          return [] as CollectionWithCount[];
        }),
      ]);
      if (isCancelled()) return;
      const collectionGames = await loadCollectionGames(collections);
      if (isCancelled()) return;
      setRails(buildRails({ games, recentlyPlayed, favorites, collections, collectionGames }));
      setLoading(false);
    })();
  }, []);

  return { rails, loading };
}
