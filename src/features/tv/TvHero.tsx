// TvHero — the key-art hero region atop the TV home (v0.26 W261, tv-mode-
// design.md §Design "Hero"). Full-bleed native-resolution art of the FOCUSED
// game (snap/title preferred), a gradient scrim for legibility, and over it the
// game's 10-foot title, a system + year metadata line, and a play-time /
// last-played chip when present. Retro-but-Aura flourishes (a static scanline
// texture accent + a phosphor-glow accent) are layered via tokens, tastefully.
//
// The hero crossfades on focus SETTLE: `TvHome` hands it a debounced game so a
// rapid left/right sweep doesn't thrash the full-bleed art swap — the crossfade
// fires ~150ms after the user pauses. The crossfade itself is an AnimatePresence
// keyed on the resolved art URL, so there is no layout shift and the image is
// object-fit: cover. Unlike the tiles (local-only), the hero DOES allow a
// one-shot network fetch (`allowFetch`) so the single featured game resolves
// cinematic art even when no tier is cached yet.
//
// The play affordance registers as the TOP focus row (HERO_FOCUS_ID): a `down`
// press from it drops into the first rail (railNav.ts), and `confirm` on it
// launches the focused game — the same launch path the tiles use.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { Game } from "../../ipc/library";
import { DUR, EASE_OUT, riseIn } from "../../lib/motion";
import { useFocusable } from "../controller";
import { useGameArt } from "../library/useGameArt";
import { tvSystemLabel } from "./systems";
import { formatLastPlayed, formatPlayTime, heroMetaLine } from "./playtime";
import { HERO_FOCUS_ID } from "./railNav";

export interface TvHeroProps {
  /** The (debounced) focused game to feature, or null while the home loads. */
  game: Game | null;
  /** Launch the featured game (confirm on the hero play affordance). */
  onLaunch: (game: Game) => void;
  /** W273 hover-attract: true while a live preview plays behind the home —
   * the hero's art layer hands off to the real gameplay underneath
   * (crossfading out via its existing AnimatePresence), while the scrim,
   * accents, and copy stay so the title reads over the running game. */
  artHandedOff?: boolean;
}

/** The hero region. Renders a settle-state when no game is focused yet so the
 * home never shows a bare backdrop with no title. */
export function TvHero({ game, onLaunch, artHandedOff = false }: TvHeroProps) {
  // Prime a high-res hero tier for the featured game: snap → title → boxart
  // ("hero" surface order), and DO allow a one-shot network fetch so a game
  // with no cached tier still resolves cinematic art for the hero specifically
  // (the tiles stay local-only; only the single featured hero fetches).
  const artUrl = useGameArt(game, "snap", { surface: "hero", allowFetch: true });

  const { ref, isFocused, focus } = useFocusable<HTMLButtonElement>(HERO_FOCUS_ID, () => {
    if (game) onLaunch(game);
  });
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);

  const systemLabel = game ? tvSystemLabel(game.system) : "";
  const metaLine = game ? heroMetaLine(systemLabel, game.year) : "";
  const playTime = game ? formatPlayTime(game.totalPlayTimeMs) : null;
  const lastPlayed = game ? formatLastPlayed(game.lastPlayedAt, Date.now()) : null;

  return (
    <section className="rgp-tv-hero" aria-label="Featured game">
      {/* Full-bleed native-res art of the focused game; crossfades on URL change
          via AnimatePresence so there is no layout shift and both frames are
          object-fit: cover. `aria-hidden` — purely decorative behind the copy.
          While a W273 preview plays, the art layer exits through the same
          AnimatePresence crossfade, uncovering the live gameplay behind. */}
      <div className="rgp-tv-hero__art" aria-hidden>
        <AnimatePresence>
          {artUrl && !artHandedOff && (
            <motion.div
              key={artUrl}
              className="rgp-tv-hero__art-layer"
              style={{ backgroundImage: `url("${artUrl}")` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.base, ease: EASE_OUT }}
            />
          )}
        </AnimatePresence>
      </div>
      {/* Gradient scrim for legibility over any art. */}
      <div className="rgp-tv-hero__scrim" aria-hidden />
      {/* Retro-but-Aura accents: a static scanline texture + a phosphor glow,
          both token-driven (tv.css) and disabled under reduced-motion via the
          central rule. Purely decorative → aria-hidden. */}
      <div className="rgp-tv-hero__scanlines" aria-hidden />
      <div className="rgp-tv-hero__phosphor" aria-hidden />

      <div className="rgp-tv-hero__content">
        {game && (
          <motion.div
            key={game.id}
            className="rgp-tv-hero__meta"
            initial={riseIn.initial}
            animate={riseIn.animate}
            transition={riseIn.transition}
          >
            <h1 className="rgp-tv-hero__title">{game.cleanName}</h1>
            <p className="rgp-tv-hero__subtitle">{metaLine}</p>
            {(playTime || lastPlayed) && (
              <div className="rgp-tv-hero__chips">
                {lastPlayed && <span className="rgp-tv-hero__chip">Played {lastPlayed}</span>}
                {playTime && <span className="rgp-tv-hero__chip">{playTime} played</span>}
              </div>
            )}
          </motion.div>
        )}
        <button
          ref={ref}
          type="button"
          className="rgp-tv-hero__play"
          data-focused={isFocused ? "true" : undefined}
          onFocus={focus}
          onMouseEnter={focus}
          onClick={() => game && onLaunch(game)}
          disabled={!game}
          aria-label={game ? `Play ${game.cleanName}` : "Play"}
        >
          ▶ Play
        </button>
      </div>
    </section>
  );
}
