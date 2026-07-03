// TvHome — the leanback home surface (v0.26 W261, tv-mode-design.md §Design
// "Shelves"/"Hero"). THE centerpiece of TV mode: a full-bleed key-art hero of
// the focused game atop a stack of cover-art rails (Continue playing, Favorites,
// Recently added, then one rail per system that has games). Replaces
// `TvHomePlaceholder` inside `TvShell`.
//
// This component owns three responsibilities and delegates everything else:
//   1. DATA — `useTvLibrary` loads the three IPC slices and composes the ordered
//      rail model (pure `buildRails`); this file never touches IPC directly.
//   2. FOCUS — an EXPLICIT rail/row navigation model (railNav.ts) is installed
//      as the controller's exclusive handler while the home is mounted, so
//      left/right traverse a rail, up/down cross rails (the hero is the top
//      row), each rail remembers its last-focused tile (per-rail focus memory),
//      and `confirm` launches the focused game. This layers a deterministic
//      row/column model over the base geometric spatial engine — which alone
//      has no notion of "rail" or "remembered column" (railNav.ts header).
//   3. HERO — the currently-focused game (debounced ~150ms so a fast sweep
//      doesn't thrash the art swap) drives the hero's crossfade.
//
// The launch seam is a single `tvMode.launch(gameId)` call (TvModeContext): every
// tile + the hero play affordance route through it, so W265 can swap the whole
// launch transition in one place without touching any TV-home component.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "../../ipc/library";
import { navDirection, useController } from "../controller";
import type { SemanticAction } from "../controller";
import { useTvMode } from "./TvModeContext";
import { useTvLibrary } from "./useTvLibrary";
import { useDebouncedValue } from "./useDebouncedValue";
import { useTvExitConfirm } from "./useTvExitConfirm";
import { TvHero } from "./TvHero";
import { TvRail } from "./TvRail";
import { locateTile, rememberFocus, resolveRailNav } from "./railNav";
import type { RailFocusMemory } from "./railNav";
import type { TvRailModel } from "./rails";
import "./tv-home.css";

/** How long the focused game must hold before the hero crossfades to its art —
 * a fast left/right sweep changes focus every few frames, and the full-bleed art
 * swap should fire only once the user settles (tv-mode-design.md §Design "Hero":
 * "crossfade ≤300ms on focus settle debounced ~150ms"). */
const HERO_SETTLE_MS = 150;

/** Resolve the game a focus id points at, across every rail. The hero id and any
 * stale id resolve to null. */
function gameForFocus(rails: readonly TvRailModel[], focusId: string | null): Game | null {
  const loc = locateTile(rails, focusId);
  if (!loc) return null;
  return rails[loc.railIndex].games[loc.tileIndex] ?? null;
}

/**
 * The TV home. Composed of `<TvHero/>` over a `<TvRail/>` stack, wired to the
 * controller for pointer-free rail navigation and to `TvModeContext` for the
 * single game-launch seam. `onExit` is invoked when `back` is confirmed at the
 * home root (delegated to the shared two-press exit-confirm gesture).
 */
export function TvHome({ onExit }: { onExit: () => void }) {
  const { rails, loading } = useTvLibrary();
  const tvMode = useTvMode();
  const { focusedId, setFocus } = useController();
  const { setExclusiveHandler } = useController();

  // Per-rail focus memory lives in a ref (not state): the exclusive handler
  // reads + writes it every nav press and must see the latest value without a
  // re-render race, mirroring how ControllerProvider keeps its focus id in a ref.
  const memoryRef = useRef<RailFocusMemory>({});
  // The live rails, in a ref, so the exclusive handler (installed once) always
  // resolves nav against the current model without re-installing on every load.
  const railsRef = useRef<readonly TvRailModel[]>(rails);
  railsRef.current = rails;
  // The live focused id in a ref for the same reason.
  const focusedRef = useRef<string | null>(focusedId);
  focusedRef.current = focusedId;

  // The two-press "back again to exit" gesture, shared with TvShell's chrome so
  // the controller `back` and the on-screen affordance agree (useTvExitConfirm).
  const exitConfirm = useTvExitConfirm(onExit);
  // Keep the latest requestExit callable from the stable exclusive handler.
  const requestExitRef = useRef(exitConfirm.requestExit);
  requestExitRef.current = exitConfirm.requestExit;

  // The game the hero features: the LAST tile-focused game, held even while
  // focus sits on the hero's own play button (moving up to Play must NOT blank
  // the hero — the play button plays what the hero shows). It updates only when
  // focus lands on a tile; the hero id / a stale id leave it unchanged. Debounced
  // so a rapid sweep across a rail settles before the full-bleed art swap fires
  // (tv-mode-design.md §Design "Hero").
  const [featuredGame, setFeaturedGame] = useState<Game | null>(null);
  useEffect(() => {
    const tileGame = gameForFocus(rails, focusedId);
    if (tileGame) setFeaturedGame(tileGame);
  }, [rails, focusedId]);
  const heroGame = useDebouncedValue(featuredGame, HERO_SETTLE_MS);
  // A live (non-debounced) ref so confirm-on-hero launches the CURRENT featured
  // game without waiting out the crossfade debounce.
  const featuredRef = useRef<Game | null>(featuredGame);
  featuredRef.current = featuredGame;

  const launch = useCallback((game: Game) => tvMode.launch(game.id), [tvMode]);

  // Fold EVERY focus change (controller nav OR pointer hover) into the per-rail
  // focus memory from one place, so a later up/down that returns to a rail
  // restores the exact tile last focused there regardless of how focus got
  // there. Non-tile ids (the hero, a stale id) leave memory untouched
  // (rememberFocus no-ops), and an identical column is a no-op ref write.
  useEffect(() => {
    memoryRef.current = rememberFocus(rails, memoryRef.current, focusedId);
  }, [rails, focusedId]);

  // On the first populated load, seed focus onto the first tile of the first
  // rail so the home is immediately controller-operable with no pointer AND the
  // hero features that game from the first paint (tv-mode-design.md §Design:
  // "First mount: focus the first tile of the first populated rail"). The hero's
  // play button registers before any tile (it renders above the rails), so
  // ControllerProvider's "first focusable claims focus" lands on the hero — we
  // must move it onto the first tile. Only seeds while focus is NOT already on a
  // tile (null or the hero), so a later re-load never yanks focus from where the
  // user already is. A one-shot ref guard stops it re-firing every load.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || rails.length === 0) return;
    if (locateTile(rails, focusedRef.current)) {
      seededRef.current = true; // already on a tile — nothing to seed
      return;
    }
    const first = rails[0];
    if (first.games.length > 0) {
      setFocus(`${first.id}:${first.games[0].id}`);
      seededRef.current = true;
    }
  }, [rails, setFocus]);

  // Install the explicit rail-navigation model as the controller's EXCLUSIVE
  // handler for the lifetime of the home. Bypassing the base geometric engine is
  // deliberate: only an explicit row/column model can honour per-rail focus
  // memory and treat the hero as a first-class top row (railNav.ts). Every
  // semantic action is handled here:
  //   - nav_* → resolveRailNav → setFocus (+ record the new column in memory)
  //   - confirm → launch the focused game (the hero's own confirm is handled by
  //     its focus registration, but routing it here keeps one launch path)
  //   - back → the two-press exit-confirm gesture
  //   - menu/quit → ignored (menu long-press toggle lives at the shell level)
  const handleAction = useCallback(
    (action: SemanticAction) => {
      if (action === "back") {
        requestExitRef.current();
        return;
      }
      if (action === "confirm") {
        // Launch the focused tile's game, or — when focus is on the hero play
        // button (not a tile) — the game the hero is currently featuring.
        const game = gameForFocus(railsRef.current, focusedRef.current) ?? featuredRef.current;
        if (game) launch(game);
        return;
      }
      const dir = navDirection(action);
      if (!dir) return; // menu / quit — not a home concern
      const next = resolveRailNav(railsRef.current, focusedRef.current, dir, memoryRef.current);
      // The focus-memory fold happens in the focusedId effect (one write path,
      // shared with pointer focus), so the handler only moves focus here.
      if (next && next !== focusedRef.current) setFocus(next);
    },
    [setFocus],
  );

  useEffect(() => {
    setExclusiveHandler(handleAction);
    return () => setExclusiveHandler(null);
  }, [setExclusiveHandler, handleAction]);

  return (
    <div className="rgp-tv-home">
      <TvHero game={heroGame} onLaunch={launch} />
      <div className="rgp-tv-home__rails">
        {loading && rails.length === 0 ? (
          <p className="rgp-tv-home__loading" role="status">
            Loading your library…
          </p>
        ) : rails.length === 0 ? (
          <p className="rgp-tv-home__empty" role="status">
            No games yet — add a content folder to fill your shelves.
          </p>
        ) : (
          rails.map((rail) => (
            <TvRail key={rail.id} rail={rail} onLaunch={launch} />
          ))
        )}
      </div>
      {exitConfirm.confirming && (
        <div className="rgp-tv-home__exit-confirm" role="status">
          Press Back again to exit TV mode
        </div>
      )}
    </div>
  );
}
