// GameTile — one cover-art tile in the library gallery grid (W13).
//
// Renders an <aura-card> (translucent --aura-panel-alpha shelf) with the game's
// cover art, falling back to a labelled placeholder when no art resolves. The
// tile is a real <button> so it is keyboard/controller focusable with a visible
// focus ring NOW (the W14 spatial-nav layer will drive focus later). Moving focus
// onto the tile reports up so the parent can update the hero (harmony §1).

import { AuraCard } from "@aura/react";
import type { Game } from "../../ipc/commands";
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

  return (
    <button
      type="button"
      className="harmony-tile"
      onFocus={() => onFocusGame(game)}
      onMouseEnter={() => onFocusGame(game)}
      onClick={() => onOpen(game)}
      aria-label={`${game.cleanName} (${game.system})`}
    >
      <AuraCard class="harmony-tile__card">
        {art ? (
          <img className="harmony-tile__art" src={art} alt="" loading="lazy" />
        ) : (
          <span className="harmony-tile__placeholder">{game.system}</span>
        )}
        <span className="harmony-tile__title">{game.cleanName}</span>
      </AuraCard>
    </button>
  );
}
