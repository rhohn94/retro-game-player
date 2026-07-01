// useBoxart — resolves a game's cover-art URL with graceful fallback (W13).
//
// Resolution order, per harmony-ux-design.md §1 (placeholder when null) and the
// metadata wrappers (W8): an inline `Game.artPath` wins; otherwise a local-only
// `get_cached_art` lookup; otherwise a one-shot network `fetch_boxart`. Any
// failure (no art on the CDN, offline, IPC error) degrades silently to `null`
// so the tile/cover renders its placeholder — art is never load-bearing.

import { useState } from "react";
import { fetchBoxart, getCachedArt } from "../../ipc/commands";
import type { Game } from "../../ipc/commands";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { artUrl } from "./art";

/**
 * Resolve the displayable cover-art URL for a game.
 *
 * @param game        the game (or null while loading)
 * @param allowFetch  when true, fall back to a network fetch if no local art
 *                    exists; the grid passes false (cheap, local-only) and the
 *                    detail view passes true (it has an explicit refresh too).
 * @returns the asset URL, or null to render a placeholder.
 */
export function useBoxart(
  game: Pick<Game, "id" | "artPath"> | null,
  allowFetch = false,
): string | null {
  const [url, setUrl] = useState<string | null>(() => artUrl(game?.artPath));

  useCancellableEffect(
    (isCancelled) => {
      const inline = artUrl(game?.artPath);
      setUrl(inline);
      if (!game || inline) return;

      void (async () => {
        try {
          const cached = await getCachedArt(game.id);
          if (isCancelled()) return;
          if (cached) {
            setUrl(artUrl(cached));
            return;
          }
          if (!allowFetch) return;
          const fetched = await fetchBoxart(game.id);
          if (!isCancelled() && fetched) setUrl(artUrl(fetched));
        } catch {
          // Art is non-essential — fall through to the placeholder.
          if (!isCancelled()) setUrl(null);
        }
      })();
    },
    [game, allowFetch],
  );

  return url;
}
