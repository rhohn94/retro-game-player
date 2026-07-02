// useTvLibrary — loads the three data sources the TV home shelves need and
// composes them into the ordered rail model (v0.26 W261). Keeps all IPC + the
// pure `buildRails` composition behind one hook so `TvHome` stays a layout
// component. Degrades to whatever loaded: a failed favorites/recent call just
// drops that rail, never blanks the home.

import { useState } from "react";
import { listGames } from "../../ipc/library";
import { listRecentlyPlayed, listFavorites } from "../../ipc/play-stats";
import type { Game } from "../../ipc/library";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { buildRails, type TvRailModel } from "./rails";

/** How many recently-played / favorite rows to request from the backend. The
 * rails are art shelves, not full lists — a generous cap keeps a long history
 * from making a single rail unbounded while still feeling complete. */
const RAIL_QUERY_LIMIT = 60;

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
 * Load the library + play-stats slices and build the TV home's rail model.
 *
 * The three IPC calls run concurrently; `list_games` is the spine (its failure
 * yields an empty home), while a failed `list_recently_played` / `list_favorites`
 * simply degrades to an empty slice so that one rail is dropped rather than the
 * whole screen erroring — art and history are enhancements, never load-bearing.
 */
export function useTvLibrary(): TvLibrary {
  const [rails, setRails] = useState<TvRailModel[]>([]);
  const [loading, setLoading] = useState(true);

  useCancellableEffect((isCancelled) => {
    setLoading(true);
    void (async () => {
      // Each slice resolves to [] on failure so one bad call can't blank the
      // home; games is awaited as the spine.
      const [games, recentlyPlayed, favorites] = await Promise.all([
        listGames().catch(() => [] as Game[]),
        listRecentlyPlayed(RAIL_QUERY_LIMIT).catch(() => [] as Game[]),
        listFavorites(RAIL_QUERY_LIMIT).catch(() => [] as Game[]),
      ]);
      if (isCancelled()) return;
      setRails(buildRails({ games, recentlyPlayed, favorites }));
      setLoading(false);
    })();
  }, []);

  return { rails, loading };
}
