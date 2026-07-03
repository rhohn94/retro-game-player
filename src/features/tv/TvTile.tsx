// TvTile — one TV-scale cover-art tile in a shelf (v0.26 W261, tv-mode-design.md
// §Design "Shelves"). The 10-foot cousin of the desktop `GameTile`: bigger
// (320×440 via --rgp-tv-tile-* tokens), boxart-first via `useGameArt`, a clean-
// name caption fallback when no art resolves, and a favorite badge. Registers
// with the spatial-focus registry (`useFocusable`) so it is controller-navigable
// with no pointer; `confirm` while focused launches the game, and moving focus
// here reactively drives the hero crossfade (TvHome reads the live `focusedId`).
//
// Focus TREATMENT is intentionally class + data-attribute based (`.rgp-tv-tile`,
// `data-focused`) so the next pass (W262) can polish scale/ring/glow purely in
// CSS without touching this component. This file establishes the hooks; the
// token-driven baseline focus visuals live in tv-home.css.

import { AuraCard } from "@aura/react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import type { Game } from "../../ipc/library";
import { listItem } from "../../lib/motion";
import { useFocusable } from "../controller";
import { useGameArt } from "../library/useGameArt";
import { tileFocusId, type RailId } from "./rails";

export interface TvTileProps {
  game: Game;
  /** The rail this tile lives in — scopes its focus id so the same game in two
   * rails gets two distinct focus targets (Continue playing + its system rail). */
  railId: RailId;
  /** Fires on activate (click / Enter / controller confirm) — launches the game. */
  onLaunch: (game: Game) => void;
}

/** A single focusable TV cover tile. */
export function TvTile({ game, railId, onLaunch }: TvTileProps) {
  // Boxart-first (the crispest, most recognizable cover at a glance), falling
  // through title → snap via the "tile" surface order; local-only (no network
  // fetch) so a shelf of 50 tiles never fans out 50 CDN calls.
  const art = useGameArt(game, "boxart", { surface: "tile" });
  const focusId = tileFocusId(railId, game.id);
  const { ref, isFocused, focus } = useFocusable<HTMLButtonElement>(focusId, () => onLaunch(game));

  // Mirror controller focus to native DOM focus so the tile scrolls into view
  // and the browser draws its ring — the same bridge GameTile uses. A focused
  // tile also becomes the hero's featured game because TvHome reads the live
  // controller `focusedId` reactively; the tile itself does no hero plumbing.
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);

  // Pointer focus/hover claims controller focus (so the spatial ring can't
  // linger on a gamepad's stale position, and the hero follows the pointer).
  return (
    <motion.button
      ref={ref}
      variants={listItem}
      type="button"
      className="rgp-tv-tile"
      data-focused={isFocused ? "true" : undefined}
      onFocus={focus}
      onMouseEnter={focus}
      onClick={() => onLaunch(game)}
      aria-label={`${game.cleanName} (${game.system})`}
    >
      <AuraCard class="rgp-tv-tile__card">
        <div className="rgp-tv-tile__frame">
          {art ? (
            <img className="rgp-tv-tile__art" src={art} alt="" loading="lazy" />
          ) : (
            <span className="rgp-tv-tile__placeholder">{game.cleanName}</span>
          )}
          {game.favorite && (
            <span className="rgp-tv-tile__favorite" aria-hidden>
              ♥
            </span>
          )}
        </div>
        <span className="rgp-tv-tile__caption">{game.cleanName}</span>
      </AuraCard>
    </motion.button>
  );
}
