// GameTile — one cover-art tile in the library gallery grid (W13; v0.31 W315
// adds the non-retro source badge).
//
// Renders an <aura-card> (translucent --aura-panel-alpha shelf) with the game's
// cover art, falling back to a labelled placeholder when no art resolves. The
// tile is a real <button> so it is keyboard/controller focusable with a visible
// focus ring NOW (the W14 spatial-nav layer will drive focus later). Moving focus
// onto the tile reports up so the parent can update the hero (harmony §1).
//
// A non-retro row (Steam/App/Manual, v0.31 W310) has no console to show, so its
// placeholder/badge shows the source (Steam/App/Manual) instead of a system id
// (non-retro-library-design.md §UI: "a source badge instead of a console badge").

import { AuraCard } from "@aura/react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import type { Game } from "../../ipc/commands";
import { listItem } from "../../lib/motion";
import { useFocusable } from "../controller";
import { isNonRetro, sourceBadgeLabel } from "./sourceBadge";
import { useBoxart } from "./useBoxart";

export interface GameTileProps {
  game: Game;
  /** Fires when the tile is focused/hovered — drives the hero crossfade. */
  onFocusGame: (game: Game) => void;
  /** Fires on activate (click / Enter / controller confirm) — opens detail. */
  onOpen: (game: Game) => void;
}

/** A single focusable cover-art tile. */
export function GameTile({ game, onFocusGame, onOpen }: GameTileProps) {
  const art = useBoxart(game, false);
  // Register with the controller's spatial-nav registry. When the controller
  // moves focus here, mirror it to native DOM focus so the tile scrolls into
  // view and fires onFocus (hero crossfade); `confirm` opens the game.
  const { ref, isFocused, focus } = useFocusable<HTMLButtonElement>(`game:${game.id}`, () =>
    onOpen(game),
  );
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);

  // Mouse-driven focus/hover must claim controller focus too, not just the
  // local hero-crossfade state — otherwise the spatial-nav ring can keep
  // showing a gamepad's last position while the mouse interacts elsewhere
  // (W221, controller-input-design.md).
  const claimFocus = () => {
    focus();
    onFocusGame(game);
  };

  // Non-retro rows have no `system` — badge on the source instead (Steam/App/
  // Manual) so the tile always reads something meaningful, never "null".
  const badge = isNonRetro(game) ? sourceBadgeLabel(game.source) : game.system;

  return (
    <motion.button
      ref={ref}
      variants={listItem}
      type="button"
      role="listitem"
      className="rgp-tile"
      onFocus={claimFocus}
      onMouseEnter={claimFocus}
      onClick={() => onOpen(game)}
      aria-label={`${game.cleanName} (${badge})`}
    >
      <AuraCard class="rgp-tile__card">
        {art ? (
          <img className="rgp-tile__art" src={art} alt="" loading="lazy" />
        ) : (
          <span className="rgp-tile__placeholder">{badge}</span>
        )}
        <div className="rgp-tile__title-row">
          <span className="rgp-tile__title">{game.cleanName}</span>
          {isNonRetro(game) && (
            <span className="rgp-tile__source-badge">{sourceBadgeLabel(game.source)}</span>
          )}
        </div>
      </AuraCard>
    </motion.button>
  );
}
