// TvRail — one horizontal cover-art shelf on the TV home (v0.26 W261,
// tv-mode-design.md §Design "Shelves"). A chunky retro-accent section label over
// a scroll row of `TvTile`s. Reused for every rail (Continue playing / Favorites
// / Recently added / per-console) — the rail is data-driven, not per-kind.
//
// Windowed rendering (design: "windowed rendering for rails ≥50 items"): a rail
// at/over `WINDOW_THRESHOLD` tiles mounts only a band around the focused tile,
// with leading/trailing spacers preserving scroll geometry so the row's width
// and the focused tile's scroll position stay correct without mounting hundreds
// of off-screen `<img>`s. Shorter rails render every tile (the simple path).

import type { Game } from "../../ipc/library";
import { useController } from "../controller";
import { TvTile } from "./TvTile";
import { railWindow, tileFocusId, type TvRailModel } from "./rails";

/** How many tiles to keep mounted on each side of the focused tile in a
 * windowed (≥threshold) rail. Wide enough that a left/right press always lands
 * on an already-mounted neighbour and the next tile is pre-warmed. */
const WINDOW_RADIUS = 12;

export interface TvRailProps {
  rail: TvRailModel;
  onLaunch: (game: Game) => void;
}

/** Find the focused tile's index within this rail, or -1 when focus is
 * elsewhere. Reads the live controller focus id and matches it against this
 * rail's tile focus ids. */
function useFocusedIndex(rail: TvRailModel): number {
  const { focusedId } = useController();
  if (!focusedId) return -1;
  return rail.games.findIndex((g) => tileFocusId(rail.id, g.id) === focusedId);
}

/** A single labelled shelf. */
export function TvRail({ rail, onLaunch }: TvRailProps) {
  const focusedIndex = useFocusedIndex(rail);
  const win = railWindow(rail.games, focusedIndex, WINDOW_RADIUS);
  const trailing = win.total - (win.start + win.items.length);

  return (
    <section className="rgp-tv-rail" aria-label={rail.label}>
      <h2 className="rgp-tv-rail__label">{rail.label}</h2>
      <div className="rgp-tv-rail__row" data-rail-id={rail.id}>
        {/* Leading spacer preserves horizontal scroll geometry for the tiles
            windowed out to the left (one spacer sized to N tile-widths, not N
            real tiles). */}
        {win.start > 0 && (
          <div
            className="rgp-tv-rail__spacer"
            style={{ "--rgp-tv-spacer-count": win.start } as React.CSSProperties}
            aria-hidden
          />
        )}
        {win.items.map((game) => (
          <TvTile
            key={tileFocusId(rail.id, game.id)}
            game={game}
            railId={rail.id}
            onLaunch={onLaunch}
          />
        ))}
        {trailing > 0 && (
          <div
            className="rgp-tv-rail__spacer"
            style={{ "--rgp-tv-spacer-count": trailing } as React.CSSProperties}
            aria-hidden
          />
        )}
      </div>
    </section>
  );
}
