// Art-source helpers for the library feature (W13; high-res tier fallback W263).
//
// Cover art and pre-blurred hero bitmaps live on the filesystem. The blurred
// hero arrives as a `data:` URI from the backend (vibrancy.ts), but cover art
// from `metadata`/`Game.artPath` is an absolute filesystem path that the
// webview cannot load directly — it must be funnelled through Tauri's asset
// protocol via `convertFileSrc`. This module centralises that conversion so the
// grid/detail components never touch Tauri APIs directly.

import { convertFileSrc } from "@tauri-apps/api/core";
import type { ArtTier, CachedArtTier } from "../../ipc/metadata";

/**
 * Convert an absolute filesystem art path into a webview-loadable asset URL.
 *
 * Returns `null` for empty/null inputs so callers can fall through to the
 * placeholder. `convertFileSrc` is only defined inside the Tauri webview; in a
 * plain browser/test context it throws, so we guard and degrade to `null`.
 */
export function artUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

/** A surface that wants hero art, each with its own preferred tier order
 * (W263). `"hero"` is the full-bleed TV/detail backdrop (wants the most
 * atmospheric shot first); `"tile"` is the desktop grid (wants the crispest
 * cover first) — both fall through to whatever is cached, and finally to the
 * placeholder when nothing is cached at all. */
export type ArtSurface = "hero" | "tile";

/** Preferred-tier order per surface, most-preferred first. Exported for tests
 * and any caller that needs the raw ordering without re-deriving it. */
export const SURFACE_TIER_ORDER: Record<ArtSurface, readonly ArtTier[]> = {
  // A hero wants the most cinematic, in-motion-feeling shot: a gameplay snap
  // reads better full-bleed than a static box cover; title screens are a
  // reasonable middle ground; boxart is the fallback of last resort.
  hero: ["snap", "title", "boxart"],
  // The desktop grid tile wants the crisp, recognizable box cover first —
  // unchanged from the pre-W263 single-tier behavior.
  tile: ["boxart", "title", "snap"],
};

/**
 * Pure fallback resolver: given the tiers actually cached for a game, pick
 * the best on-disk path for `surface`, walking that surface's preferred tier
 * order (W263 acceptance: "fallback order snap → title → boxart → blur").
 *
 * Returns `null` when `cachedTiers` is empty (or none of its entries match a
 * known tier) — callers render their placeholder/blurred-fallback in that
 * case. No IO, no Tauri APIs — safe to unit-test directly.
 */
export function heroArtFor(
  cachedTiers: readonly Pick<CachedArtTier, "tier" | "path">[],
  surface: ArtSurface,
): string | null {
  const order = SURFACE_TIER_ORDER[surface];
  for (const tier of order) {
    const hit = cachedTiers.find((entry) => entry.tier === tier);
    if (hit) return hit.path;
  }
  return null;
}
