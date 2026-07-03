// Typed wrappers for the `metadata` domain (W8; per-tier hi-res pipeline W263).
//
// `fetch_boxart` downloads from the libretro-thumbnails CDN (with 3-tier
// fallback) and caches the result on disk. Returns the on-disk path, or an
// empty string when no art is available for the game.
//
// `get_cached_art` performs a local-only lookup — no network call.
//
// `fetch_game_art` / `get_cached_art_tiers` (W263) expose the SAME three CDN
// tiers individually, at full (never downscaled) resolution, so hero surfaces
// can request e.g. a snap even when a boxart is already cached.

import { invoke } from "./invoke";
import type { Game } from "./library";

/** The three libretro-thumbnails CDN tiers, in ascending "index quality"
 * order (boxart is the richest/preferred tier; matches Rust `ArtTier`). */
export type ArtTier = "boxart" | "title" | "snap";

/** One cached art tier entry, as returned by `get_cached_art_tiers`. Mirrors
 * Rust `CachedArtTierDto`. */
export interface CachedArtTier {
  tier: ArtTier;
  path: string;
}

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

/**
 * Fetch ONE named art tier for a game from the libretro-thumbnails CDN at
 * full resolution (W263), independent of the other tiers.
 *
 * Idempotent and safe to call concurrently for the same `(gameId, tier)` —
 * the backend upserts the cache row either way.
 *
 * @returns The on-disk path of the cached image, or an empty string if the
 * CDN has no art for this game under this tier (e.g. no snap available).
 */
export function fetchGameArt(gameId: number, tier: ArtTier): Promise<string> {
  return invoke<string>("fetch_game_art", { gameId, tier });
}

/**
 * Return every art tier already cached on disk for a game, without hitting
 * the network (W263). Ordered boxart → title → snap; empty when nothing has
 * been fetched yet.
 */
export function getCachedArtTiers(gameId: number): Promise<CachedArtTier[]> {
  return invoke<CachedArtTier[]>("get_cached_art_tiers", { gameId });
}

/**
 * Auto-download relevant metadata for a game: cover art (libretro CDN) and a
 * Wikipedia description + canonical article URL. Best-effort — a miss leaves the
 * un-enriched fields untouched. Resolves to the (possibly updated) game so the
 * caller can refresh in place. Invoked automatically after an import and on a
 * manual "refresh metadata" action.
 */
export function enrichGameMetadata(gameId: number): Promise<Game> {
  return invoke<Game>("enrich_game_metadata", { gameId });
}
