// useGameArt — resolves a game's HIGH-RESOLUTION art URL for a given tier,
// with the per-surface fallback order applied (W263 — high-resolution +
// full-bleed artwork pipeline).
//
// This sits alongside useBoxart rather than replacing it: useBoxart is the
// desktop grid tile's single-tier, `Game.artPath`-first resolver (unchanged
// by this work item). useGameArt is for surfaces that want the FULL CDN tier
// set (boxart/title/snap) with the richer fallback chain from `heroArtFor` —
// e.g. the upcoming TV hero. Both hooks share the same local-cache-first,
// optional-network-fetch resolution shape; that shared shape is intentionally
// NOT re-abstracted into a third layer here, since the two hooks query
// different IPC surfaces (`get_cached_art`/`fetch_boxart` vs.
// `get_cached_art_tiers`/`fetch_game_art`) and abstracting over that
// difference would obscure more than it saves — see
// docs/coding-standards.md "genuinely coincidental" duplication carve-out.

import { useState } from "react";
import { getCachedArtTiers, fetchGameArt } from "../../ipc/metadata";
import type { ArtTier, CachedArtTier } from "../../ipc/metadata";
import type { Game } from "../../ipc/library";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { artUrl, heroArtFor, type ArtSurface } from "./art";

/** Options for {@link useGameArt}. */
export interface UseGameArtOptions {
  /** The surface consuming the art — selects the fallback tier order via
   * `heroArtFor` (`"hero"`: snap → title → boxart; `"tile"`: boxart → title
   * → snap). Defaults to `"hero"`, this hook's primary consumer. */
  surface?: ArtSurface;
  /** When true, and no tier is cached locally at all, fall back to a network
   * fetch of the single requested `tier` (mirrors useBoxart's `allowFetch`).
   * Defaults to false (cheap, local-only) — callers that want a guaranteed
   * fetch (e.g. a detail/hero surface with its own loading state) opt in. */
  allowFetch?: boolean;
}

/**
 * Resolve the displayable, full-resolution art URL for `game` at the
 * requested `tier`, applying the surface's fallback order across whatever
 * tiers are actually cached.
 *
 * Resolution order:
 * 1. Local-only `get_cached_art_tiers` lookup, resolved through
 *    `heroArtFor(tiers, surface)`.
 * 2. If nothing is cached AND `allowFetch` is set, a one-shot
 *    `fetch_game_art(gameId, tier)` network call for the REQUESTED tier
 *    specifically (not the whole fallback chain — callers that want the
 *    full chain fetched should request their preferred tier first, then
 *    let the user/UI re-request a fallback tier on a subsequent miss).
 *
 * Any failure (CDN miss, offline, IPC error) degrades silently to `null` so
 * the caller renders its placeholder — art is never load-bearing.
 *
 * @param game       the game (or null while loading)
 * @param tier       the tier the caller would prefer, absent any cache hit
 * @param options    surface (fallback order) + allowFetch
 * @returns the asset URL, or null to render a placeholder/blurred fallback.
 */
export function useGameArt(
  game: Pick<Game, "id"> | null,
  tier: ArtTier,
  options: UseGameArtOptions = {},
): string | null {
  const { surface = "hero", allowFetch = false } = options;
  const [url, setUrl] = useState<string | null>(null);

  useCancellableEffect(
    (isCancelled) => {
      setUrl(null);
      if (!game) return;

      void (async () => {
        try {
          const cachedTiers = await getCachedArtTiers(game.id);
          if (isCancelled()) return;

          const resolved = heroArtFor(cachedTiers, surface);
          if (resolved) {
            setUrl(artUrl(resolved));
            return;
          }

          if (!allowFetch) return;
          const fetched = await fetchGameArt(game.id, tier);
          if (!isCancelled() && fetched) setUrl(artUrl(fetched));
        } catch {
          // Art is non-essential — fall through to the placeholder.
          if (!isCancelled()) setUrl(null);
        }
      })();
    },
    [game, tier, surface, allowFetch],
  );

  return url;
}

/** Re-exported so consumers of this hook don't need a separate import from
 * `../../ipc/metadata` just to type a tier/cached-tier value. */
export type { ArtTier, CachedArtTier };
