// Typed wrappers for the `metadata` domain (W8).
//
// `fetch_boxart` downloads from the libretro-thumbnails CDN (with 3-tier
// fallback) and caches the result on disk. Returns the on-disk path, or an
// empty string when no art is available for the game.
//
// `get_cached_art` performs a local-only lookup — no network call.

import { invoke } from "./invoke";

/**
 * Fetch boxart for a game from the libretro-thumbnails CDN.
 *
 * Tries: full No-Intro name → short name → Named_Titles → Named_Snaps.
 * Caches the result on disk and persists the cache entry.
 *
 * @returns The on-disk path of the cached art, or an empty string if the CDN
 * has no art for this game (show a placeholder).
 */
export function fetchBoxart(gameId: number): Promise<string> {
  return invoke<string>("fetch_boxart", { gameId });
}

/**
 * Return the cached art path for a game without hitting the network.
 *
 * @returns The on-disk path if art has been previously fetched, or `null` if
 * the cache is empty for this game.
 */
export function getCachedArt(gameId: number): Promise<string | null> {
  return invoke<string | null>("get_cached_art", { gameId });
}
