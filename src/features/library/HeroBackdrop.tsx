// HeroBackdrop — the full-bleed art layer behind the library/detail screens
// (W13; harmony-ux-design.md §0/§1). Extended in W263 with an UNBLURRED
// full-resolution variant for TV/leanback surfaces.
//
// Two variants, selected via the `variant` prop (default `"blurred"` — the
// existing desktop behavior, UNCHANGED by this extension):
//
//   "blurred" (default) — the softness is the BACKEND's pre-blurred bitmap
//     (vibrancy.ts → get_blurred_hero); there is NO CSS/JS blur filter here
//     (architecture §5.2). The small blurred bitmap is scaled up to cover the
//     viewport; native window vibrancy reads through the translucent shelves
//     layered on top.
//
//   "full-bleed" — renders the game's native-resolution, UNBLURRED art
//     (highest-priority cached tier, resolved via `heroArtFor`) with
//     `object-fit: cover` and a gradient scrim slot for text legibility. No
//     backend blur round-trip. This is the TV-hero consumer path (tv-mode-design.md);
//     no current call site opts into it yet — this item only adds the
//     capability.
//
// Both variants CROSSFADE on game change (Framer Motion opacity), honouring
// prefers-reduced-motion.

import { AnimatePresence, motion } from "framer-motion";
import { DUR } from "../../lib/motion";
import { useState } from "react";
import { getBlurredHero } from "../../ipc/commands";
import { getCachedArtTiers } from "../../ipc/metadata";
import type { Game } from "../../ipc/commands";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { artUrl, heroArtFor } from "./art";

/** Resolve the pre-blurred hero data URI for a game (or null). */
function useBlurredHero(game: Game | null): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useCancellableEffect(
    (isCancelled) => {
      if (!game || !game.artPath) {
        setUri(null);
        return;
      }
      void (async () => {
        try {
          const hero = await getBlurredHero({ gameId: game.id, artPath: game.artPath as string });
          if (!isCancelled()) setUri(hero.dataUri);
        } catch {
          if (!isCancelled()) setUri(null);
        }
      })();
    },
    [game],
  );

  return uri;
}

/** Resolve the best cached full-resolution art URL for the "full-bleed" variant,
 * applying the "hero" surface's fallback order (snap → title → boxart) over
 * whatever tiers are locally cached. Local-only — no network fetch, mirroring
 * `useBlurredHero`'s degrade-to-null-on-any-failure behavior. */
function useFullBleedArt(game: Game | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useCancellableEffect(
    (isCancelled) => {
      setUrl(null);
      if (!game) return;
      void (async () => {
        try {
          const tiers = await getCachedArtTiers(game.id);
          if (isCancelled()) return;
          const resolved = heroArtFor(tiers, "hero");
          setUrl(resolved ? artUrl(resolved) : null);
        } catch {
          if (!isCancelled()) setUrl(null);
        }
      })();
    },
    [game],
  );

  return url;
}

/** Which bitmap `HeroBackdrop` renders. See file header for the full contrast. */
export type HeroBackdropVariant = "blurred" | "full-bleed";

/**
 * Full-bleed crossfading backdrop driven by the focused/selected game.
 *
 * @param variant `"blurred"` (default, desktop) or `"full-bleed"` (TV/leanback,
 * native-resolution, unblurred — see file header). Existing call sites that
 * don't pass `variant` are byte-for-byte unaffected.
 */
export function HeroBackdrop({
  game,
  variant = "blurred",
}: {
  game: Game | null;
  variant?: HeroBackdropVariant;
}) {
  // Both hooks are called unconditionally (rules-of-hooks); each is a no-op
  // (stays null) when its own variant isn't active, since only one of the two
  // `game` transitions per render actually drives its effect's IPC calls'
  // downstream state used below.
  const blurredUri = useBlurredHero(variant === "blurred" ? game : null);
  const fullBleedUri = useFullBleedArt(variant === "full-bleed" ? game : null);

  const uri = variant === "full-bleed" ? fullBleedUri : blurredUri;
  const layerClassName =
    variant === "full-bleed"
      ? "rgp-hero-backdrop__layer rgp-hero-backdrop__layer--full-bleed"
      : "rgp-hero-backdrop__layer";

  return (
    <div className="rgp-hero-backdrop" aria-hidden>
      <AnimatePresence>
        {uri && (
          <motion.div
            key={uri}
            className={layerClassName}
            style={{ backgroundImage: `url("${uri}")` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.entrance }}
          />
        )}
      </AnimatePresence>
      {variant === "full-bleed" && uri && (
        <div className="rgp-hero-backdrop__scrim" />
      )}
    </div>
  );
}
