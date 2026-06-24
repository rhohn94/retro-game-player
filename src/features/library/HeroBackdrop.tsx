// HeroBackdrop — the full-bleed, pre-blurred art layer behind the library/detail
// screens (W13; harmony-ux-design.md §0/§1).
//
// The softness is the BACKEND's pre-blurred bitmap (vibrancy.ts → get_blurred_hero)
// — there is NO CSS/JS blur filter here (architecture §5.2). The small blurred
// bitmap is scaled up to cover the viewport; native window vibrancy reads through
// the translucent shelves layered on top. When the selected game changes the new
// backdrop CROSSFADES in (Framer Motion opacity), honouring prefers-reduced-motion.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { getBlurredHero } from "../../ipc/commands";
import type { Game } from "../../ipc/commands";

/** Resolve the pre-blurred hero data URI for a game (or null). */
function useBlurredHero(game: Game | null): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!game || !game.artPath) {
      setUri(null);
      return;
    }
    void (async () => {
      try {
        const hero = await getBlurredHero({ gameId: game.id, artPath: game.artPath as string });
        if (!cancelled) setUri(hero.dataUri);
      } catch {
        if (!cancelled) setUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game]);

  return uri;
}

/** Full-bleed crossfading backdrop driven by the focused/selected game. */
export function HeroBackdrop({ game }: { game: Game | null }) {
  const uri = useBlurredHero(game);

  return (
    <div className="harmony-hero-backdrop" aria-hidden>
      <AnimatePresence>
        {uri && (
          <motion.div
            key={uri}
            className="harmony-hero-backdrop__layer"
            style={{ backgroundImage: `url("${uri}")` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
