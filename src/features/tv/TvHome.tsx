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
//
// v0.27 W273 adds a fourth, self-contained concern: HOVER-ATTRACT. Dwelling on
// an eligible tile for TV_ATTRACT_DWELL_MS boots that game as a live,
// full-bleed, no-trace preview behind the home — NativePlayer or (v0.37 W376)
// InPagePlayer, whichever `resolveAttractPreviewPath` picks, both mounted in
// the "preview" presentation (input never attaches, audio ducks, nothing is
// recorded or saved). The dwell rules live in useAttractDwell; this component
// only resolves the dwelt candidate (focused tile → eligible game + path) and
// mounts the preview layer. A failed preview start silently falls back to
// today's static art and that game is not retried this mount.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Game } from "../../ipc/library";
import { getNativePlayEnabled } from "../../ipc/native-play";
import { listInPageCores } from "../../ipc/inpage-cores";
import type { InPageCore } from "../../ipc/inpage-cores";
import { DUR, EASE_OUT } from "../../lib/motion";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { useWindowFocus } from "../../hooks/useWindowFocus";
import { InPagePlayer, NativePlayer, fetchNativeCapabilities, resolveAttractPreviewPath } from "../play";
import type { NativeCapabilities } from "../play";
import { navDirection, useController } from "../controller";
import type { SemanticAction } from "../controller";
import { useTvMode } from "./TvModeContext";
import { useTvLibrary } from "./useTvLibrary";
import { useAttractDwell } from "./useAttractDwell";
import { useDebouncedValue } from "./useDebouncedValue";
import { useTvExitConfirm } from "./useTvExitConfirm";
import { TvHero } from "./TvHero";
import { TvRail } from "./TvRail";
import { locateTile, rememberFocus, resolveRailNav } from "./railNav";
import type { RailFocusMemory } from "./railNav";
import type { TvRailModel } from "./rails";
import { swallow } from "../../ipc/swallow";
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
  const { focusedId, setFocus, focusElement, claimExclusive } = useController();

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

  // Launch into the in-TV takeover (W265). The takeover expands from the tile
  // the user launched from, so we capture that tile's viewport rect here. The
  // focused tile mirrors controller focus to DOM focus (TvTile), so at confirm
  // time `document.activeElement` is the originating tile button; a pointer
  // click lands its own target as `activeElement` too. When neither resolves to
  // a launch button (e.g. the hero Play, which is focused but is not a tile) we
  // pass null and the takeover falls back to a centred crossfade.
  const launch = useCallback(
    (game: Game) => {
      // Launching supersedes any armed exit intent: without this, a `back`
      // pressed just before confirm left the exit-confirm armed under the
      // takeover, and a quick play-and-return inside its window let a SINGLE
      // back press silently exit TV mode (W275).
      exitConfirm.cancel();
      const active = document.activeElement as HTMLElement | null;
      const rect = active?.getBoundingClientRect();
      const originRect =
        rect && rect.width > 0 && rect.height > 0
          ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
          : null;
      tvMode.launch(game, originRect);
    },
    [tvMode, exitConfirm.cancel],
  );

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

  // ── W273/W376 hover-attract ───────────────────────────────────────────────
  // Previews prefer the native path (the purity guarantee is structural
  // there) and fall back to the EJS path since v0.37 W376
  // (resolveAttractPreviewPath), so resolve everything both paths need once:
  // the native opt-in flag, the native-capability table (W340), and the
  // in-page core catalog (W241) — until all three answer, nothing is
  // eligible and no preview can boot.
  const [nativeEnabled, setNativeEnabled] = useState(false);
  const [nativeCapabilities, setNativeCapabilities] = useState<NativeCapabilities>(
    () => new Map(),
  );
  const [inPageCores, setInPageCores] = useState<InPageCore[] | null>(null);
  useCancellableEffect((isCancelled) => {
    getNativePlayEnabled()
      .then((enabled) => !isCancelled() && setNativeEnabled(enabled))
      .catch((err: unknown) => swallow(err, "TvHome.getNativePlayEnabled"));
    fetchNativeCapabilities().then((caps) => !isCancelled() && setNativeCapabilities(caps));
    listInPageCores()
      .then((list) => !isCancelled() && setInPageCores(list))
      .catch((err: unknown) => swallow(err, "TvHome.listInPageCores"));
  }, []);

  // Games whose preview session failed to start this mount: silently fall
  // back to static art and never retry them (no visible error on the home —
  // a re-dwell would otherwise loop the failure).
  const [failedPreviewIds, setFailedPreviewIds] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );
  const markPreviewFailed = useCallback((gameId: number) => {
    setFailedPreviewIds((prev) => new Set(prev).add(gameId));
  }, []);

  // The dwelt candidate: the CURRENTLY focused tile's game (pointer hover
  // funnels into controller focus — TvTile.onMouseEnter → focus — so this is
  // the one shared notion of "dwelt upon"), and only when it resolves to a
  // real preview path (native or, since W376, EJS). The hero play row is not
  // a tile, so it never previews. Any focus change resets the dwell
  // (useAttractDwell keys on the focus id).
  const launched = tvMode.launched;
  const focusedTileGame = gameForFocus(rails, focusedId);
  // A non-ROM game (v0.31 W310) has no `system` and is never preview-eligible
  // (neither play path resolves without one).
  const previewPath = focusedTileGame?.system
    ? resolveAttractPreviewPath(focusedTileGame.system, nativeEnabled, nativeCapabilities, inPageCores)
    : { kind: "none" as const };
  const dwellGame =
    focusedTileGame &&
    previewPath.kind !== "none" &&
    !failedPreviewIds.has(focusedTileGame.id)
      ? focusedTileGame
      : null;
  // The dwell only counts — and a fired preview only lives — while the app
  // window holds focus (W275): without this gate the timer kept running
  // behind a Cmd+Tab and booted an audible preview while the app was
  // backgrounded, which W243 pause-on-blur cannot catch (the blur predates
  // the session's mount, so its blur listener never fires). Blurring tears a
  // running preview down; refocusing re-dwells from zero.
  const windowFocused = useWindowFocus();
  // W278: the system menu gates the dwell the same way exitConfirm.confirming
  // already does — "something more important than the home is showing" — so
  // opening the menu tears a running/building preview down immediately rather
  // than leaving it to boot (or keep playing, audibly) behind the overlay.
  const previewGame = useAttractDwell({
    key: focusedId,
    game: dwellGame,
    enabled: launched === null && !exitConfirm.confirming && !tvMode.menuOpen && windowFocused,
  });

  // W278: opening the system menu also cancels an armed exit-confirm — the
  // same "something else now owns the moment" reasoning `launch()` above
  // already applies, so a `back` pressed just before the menu opens can never
  // leave a stale confirm armed underneath the overlay (mirrors the W275
  // launch-supersedes-exit-confirm fix).
  const menuOpenRef = useRef(tvMode.menuOpen);
  useEffect(() => {
    if (tvMode.menuOpen && !menuOpenRef.current) {
      exitConfirm.cancel();
    }
    menuOpenRef.current = tvMode.menuOpen;
  }, [tvMode.menuOpen, exitConfirm.cancel]);

  // Keyboard/DOM-focus parity across a takeover (W275). While a game is taken
  // over the home is `inert` (below), which makes the browser drop DOM focus
  // from the originating tile — otherwise a stray Enter/Space kept re-firing
  // the tile's click under the running game, and Tab reached hidden home
  // controls. On the way BACK, controller focus never moved (the overlay
  // design's whole point) so the tiles' own focus-mirroring effects don't
  // re-fire — re-assert native DOM focus on the focused tile explicitly so a
  // keyboard user lands exactly where they launched from.
  const wasLaunchedRef = useRef(launched !== null);
  useEffect(() => {
    const wasLaunched = wasLaunchedRef.current;
    wasLaunchedRef.current = launched !== null;
    if (wasLaunched && launched === null && focusedRef.current) {
      focusElement(focusedRef.current);
    }
  }, [launched, focusElement]);

  // Claim the home's exclusive handler for the LIFETIME of the mount. The
  // exclusive slot is a layered claim stack (W275, ControllerProvider): while a
  // game is taken over, the surface's fallback and then its player claim ABOVE
  // this one, so the home receives nothing — and every release (player swap,
  // surface unmount) uncovers the next claim down rather than emptying the
  // slot. That closes the no-owner windows the old launched-gated install/
  // release dance left open (actions leaking to the base spatial engine over
  // the still-mounted home during takeover boot).
  useEffect(() => claimExclusive(handleAction), [claimExclusive, handleAction]);

  return (
    // `inert` while a game is taken over: the home stays mounted (per-rail
    // focus memory + scroll live there, W265) but must be unreachable — no
    // DOM focus (the origin tile would otherwise keep keyboard focus under
    // the running game, where Enter re-fired its launch), no Tab stops, no
    // pointer events. The takeover surface visually covers it anyway; inert
    // makes the coverage real for input too (W275).
    <div className="rgp-tv-home" inert={launched !== null || undefined}>
      {/* W273/W376 live attract preview — a full-bleed spectator layer
          BETWEEN the hero backdrop and the rails (z-order: preview first in
          the DOM, hero/rails positioned after it, tv-home.css). Crossfades
          in/out via the central motion source; reduced motion is honoured
          automatically by the app-level MotionConfig. The whole layer is
          conditional on NOT being launched OUTSIDE AnimatePresence so a real
          launch unmounts the preview session IMMEDIATELY (its stop is
          dispatched before the takeover's start in the same commit — cleanup
          runs first); only dwell-driven teardown gets the exit crossfade. At
          most one preview ever exists: the dwell hook clears to null before a
          new game can complete its own full dwell, so sessions never
          overlap. Which player mounts is `previewPath` (resolved from the
          SAME focused tile useAttractDwell keys on — the dwell contract
          guarantees `previewGame`, while non-null, is still the currently
          focused tile's game, so `previewPath` always describes it). */}
      {launched === null && (
        <AnimatePresence>
          {previewGame && (
            <motion.div
              key={previewGame.id}
              className="rgp-tv-home__preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.slow, ease: EASE_OUT }}
              aria-hidden
              data-testid="tv-attract-preview"
            >
{previewPath.kind === "ejs" ? (
                <InPagePlayer
                  gameId={previewGame.id}
                  ejsSystem={previewPath.ejsCore}
                  gameName={previewGame.cleanName}
                  presentation="preview"
                  onUnavailable={() => markPreviewFailed(previewGame.id)}
                />
              ) : (
                <NativePlayer
                  gameId={previewGame.id}
                  gameName={previewGame.cleanName}
                  presentation="preview"
                  onStartFailed={() => markPreviewFailed(previewGame.id)}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      <TvHero
        game={heroGame}
        onLaunch={launch}
        artHandedOff={launched === null && previewGame !== null}
      />
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
