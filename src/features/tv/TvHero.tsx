// TvHero — the key-art hero region atop the TV home (v0.26 W261, tv-mode-
// design.md §Design "Hero"). Full-bleed native-resolution art of the FOCUSED
// game (snap/title preferred), a gradient scrim for legibility, and over it the
// game's 10-foot title, a system + year metadata line, and a play-time /
// last-played chip when present. Retro-but-Aura flourishes (a static scanline
// texture accent + a phosphor-glow accent) are layered via tokens, tastefully.
//
// The hero crossfades on focus SETTLE: `TvHome` hands it a debounced game (see
// useDebouncedValue) so a rapid left/right sweep doesn't thrash the full-bleed
// art swap — the crossfade fires ~150ms after the user pauses. The crossfade
// itself is `HeroBackdrop`'s AnimatePresence keyed on the resolved art URL, so
// there is no layout shift and the image is object-fit: cover.
//
// The play affordance registers as the TOP focus row (HERO_FOCUS_ID): a `down`
// press from it drops into the first rail, and `confirm` on it launches the
// focused game — the same launch path the tiles use.

import { motion } from "framer-motion";
import { useEffect } from "react";
import type { Game } from "../../ipc/library";
import { riseIn } from "../../lib/motion";
import { useFocusable } from "../controller";
import { HeroBackdrop } from "../library/HeroBackdrop";
import { useGameArt } from "../library/useGameArt";
import { tvSystemLabel } from "./systems";
import { formatLastPlayed, formatPlayTime, heroMetaLine } from "./playtime";
import { HERO_FOCUS_ID } from "./railNav";

export interface TvHeroProps {
  /** The (debounced) focused game to feature, or null while the home loads. */
  game: Game | null;
  /** Launch the featured game (confirm on the hero play affordance). */
  onLaunch: (game: Game) => void;
}

/** The hero region. Renders a settle-state when no game is focused yet so the
 * home never shows a bare backdrop with no title. */
export function TvHero({ game, onLaunch }: TvHeroProps) {
  // Prime a high-res hero tier for the featured game: snap → title → boxart
  // ("hero" surface order), and DO allow a one-shot network fetch so a game
  // with no cached tier still resolves cinematic art for the hero specifically
  // (the tiles stay local-only; only the single featured hero fetches).
  useGameArt(game, "snap", { surface: "hero", allowFetch: true });

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
    <div className="rgp-tv-hero">
      {/* Full-bleed native-res art of the focused game; crossfades on change. */}
      <HeroBackdrop game={game} variant="full-bleed" />
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
                {lastPlayed && (
                  <span className="rgp-tv-hero__chip">Played {lastPlayed}</span>
                )}
                {playTime && (
                  <span className="rgp-tv-hero__chip">{playTime} played</span>
                )}
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
    </div>
  );
}
