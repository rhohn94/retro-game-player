// Typed wrappers for the `vibrancy` domain (W10).
// Mirrors the Rust BlurredHero DTO (master contract architecture-design.md §2.6).

import { invoke } from "./invoke";

/** DTO returned by `get_blurred_hero`. Mirrors `blur_cache::BlurredHero`. */
export interface BlurredHero {
  /** `data:image/png;base64,…` inline data URI; null only on an encode failure. */
  dataUri: string | null;
  /** Absolute path to `blur-cache/<game_id>.png`. */
  cachePath: string;
  /** Blurred bitmap width (px, post-downscale, ≤ 96 on the longest edge). */
  width: number;
  /** Blurred bitmap height (px, post-downscale, ≤ 96 on the longest edge). */
  height: number;
}

/**
 * Retrieve (or compute and cache) the pre-blurred hero bitmap for the given
 * game. `artPath` is the absolute filesystem path to the game's cover art.
 *
 * The backend runs the blur off the UI thread; the first call per game is the
 * expensive one; subsequent calls return the cached result instantly.
 */
export function getBlurredHero(args: {
  gameId: number;
  artPath: string;
}): Promise<BlurredHero> {
  return invoke<BlurredHero>("get_blurred_hero", {
    game_id: args.gameId,
    art_path: args.artPath,
  });
}
