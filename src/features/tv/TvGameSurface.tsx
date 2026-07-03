// TvGameSurface — the in-TV fullscreen game takeover (v0.26 W265, tv-mode-
// design.md §Design "Transitions"). Rendered by TvShell as an OVERLAY on top of
// the (still-mounted) TV home when a game is launched, so the home's per-rail
// focus memory + scroll position survive untouched and exit lands exactly on the
// originating tile.
//
// The reveal contract (encoded purely in tvTakeover.ts; this component is the
// DOM/motion realisation of it):
//   1. The launched tile's cover art expands from its tile rect to fill the
//      viewport (Framer Motion). The player (PlaySwitch — in-page EmulatorJS,
//      native canvas, or the branded external surface) is ALREADY mounting +
//      booting UNDERNEATH the expanding art (boot screen + sound intact — never
//      gated, never muted; muted-on-boot is a bug).
//   2. As soon as the player surface EXISTS (not on a fixed timer), the cover
//      art crossfades out, uncovering the live player. We do not hold the cover
//      over the boot screen artificially long — the EmulatorJS boot screen is
//      part of the retro vibe.
//   3. Exiting (overlay Exit / back-out) collapses the surface back toward the
//      originating tile rect, then unmounts — TvHome underneath is exactly where
//      it was, focus restored.
//   4. Reduced motion collapses the expand into a plain crossfade (no scale/
//      translate) — the app's central reduced-motion policy drives it via the
//      `reducedMotion` flag threaded into the takeover state machine.
//
// External (RetroArch-only) systems have no in-page/native player to mount, so
// they get a branded "Running in RetroArch" surface with a Return affordance —
// the same honesty the desktop external path shows, dressed for the couch.

import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Game } from "../../ipc/library";
import { launchGame } from "../../ipc/launch";
import { DUR, EASE_OUT } from "../../lib/motion"; // cover expand/collapse timing
import { PlaySwitch } from "../play";
import { canPlayInPage } from "../play/ejs";
import { useController } from "../controller";
import type { SemanticAction } from "../controller";
import { useGameArt } from "../library/useGameArt";
import {
  beginCollapse,
  beginTakeover,
  isCoverVisible,
  isPlayerUncovered,
  revealPlayer,
  type TileRect,
} from "./tvTakeover";
import { TvExternalSurface } from "./TvExternalSurface";
import "./tv-game-surface.css";

export interface TvGameSurfaceProps {
  /** The game to take over to. */
  game: Game;
  /** The originating tile's viewport rect (for the expand/collapse), or null
   * when launched from a non-tile affordance (centred plain crossfade). */
  originRect: TileRect | null;
  /** Collapse-then-unmount: called once the exit collapse animation completes,
   * so the parent can drop the surface and hand focus back to the home. */
  onExited: () => void;
}

/** A pixel geometry rect the cover animates through. All numeric so Framer
 * interpolates cleanly (mixing a raw number with a `vw`/`vh` string can stall
 * the tween). */
interface CoverGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The full-viewport geometry the cover expands to / collapses from — read from
 * the live viewport in pixels (SSR-safe fallback keeps it a plain rect). */
function filledGeometry(): CoverGeometry {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  return { top: 0, left: 0, width, height };
}

/** The tile-rect geometry the cover expands FROM / collapses TO. Falls back to
 * the full-viewport geometry when there is no source rect (a centred plain
 * crossfade — no visible slide, only the opacity crossfade carries the swap). */
function tileGeometry(rect: TileRect | null): CoverGeometry {
  if (!rect) return filledGeometry();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** The cover layer's animate target for a phase:
 *   - expanding  → fill the viewport, fully opaque (art the user saw grows up).
 *   - revealed   → stay filled but fade OUT, uncovering the live player.
 *   - collapsing → fade back IN and shrink to the tile rect (reverse).
 * The single persistent motion element animates between these, so there is no
 * mount race — the collapse starts from wherever the reveal left it (filled). */
function coverTarget(rect: TileRect | null, phase: string) {
  if (phase === "collapsing") return { ...tileGeometry(rect), opacity: 1 };
  if (phase === "revealed") return { ...filledGeometry(), opacity: 0 };
  return { ...filledGeometry(), opacity: 1 }; // expanding
}

/**
 * The fullscreen game takeover surface. Owns the expand/reveal/collapse
 * animation and mounts the correct player underneath in the "takeover"
 * presentation (v0.27 W272): the player fills the surface edge-to-edge (no
 * desktop 760px card, no chip bar — the PlayerOverlay is the sole in-game
 * menu here) and owns the controller's exclusive slot via the shared scope
 * (useExclusiveControllerScope) — `menu` summons the overlay, every other
 * semantic action is swallowed, so nothing reaches the still-mounted home
 * underneath. This surface additionally claims a swallow-all FALLBACK beneath
 * the player's claim (W275) so the boot/swap/get-core/external windows where
 * no player owns the slot still never leak to the home.
 */
export function TvGameSurface({ game, originRect, onExited }: TvGameSurfaceProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const [state, setState] = useState(() => beginTakeover(game.id, originRect, reducedMotion));

  // The cover art shown during the expand — boxart-first via the SAME resolver +
  // surface order the tile used, so the art the user was looking at is the art
  // that expands (no jarring swap). Local-only: the tile already warmed this.
  const coverArt = useGameArt(game, "boxart", { surface: "tile" });

  // The player is visually revealed once the cover has crossed out. It stays
  // visible while collapsing so the game keeps rendering under the shrinking
  // cover (`isPlayerUncovered` is `revealed`-only; OR in `collapsing` so the
  // player doesn't blank the moment exit begins).
  const playerVisible = isPlayerUncovered(state) || state.phase === "collapsing";
  const coverVisible = isCoverVisible(state);
  const isExternal = !canPlayInPage(game.system);

  // Reveal the live player as soon as its surface exists. In-page/native mount a
  // player synchronously, so a microtask-deferred reveal is enough to let the
  // expand paint one frame before the crossfade begins; the reveal is idempotent
  // so firing it once here is safe. (Under reduced motion the state already began
  // `revealed`, and revealPlayer no-ops.)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setState((s) => revealPlayer(s)));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Exit: begin the collapse. When the surface has no cover art to animate (or
  // under reduced motion) the collapse still runs through onAnimationComplete →
  // onExited so the unmount happens exactly once.
  const exiting = useRef(false);
  const requestExit = useCallback(() => {
    if (exiting.current) return;
    exiting.current = true;
    setState((s) => beginCollapse(s));
  }, []);

  // Surface-level exclusive-controller FALLBACK for EVERY play path (W275).
  // The mounted player claims the slot itself as a gameplay owner (the shared
  // exclusive-controller scope, W272), but there are honest windows where no
  // player claim exists: the in-page player before its play origin resolves,
  // the native→in-page failure swap, the GetCorePanel path (which mounts no
  // player at all), and the external path (no player by design). Without a
  // fallback those windows dropped to the base spatial engine over the
  // still-mounted home — the original W272 leak resurfacing. This claim
  // covers the surface's WHOLE life: `back` collapses the takeover (and for
  // external — whose only affordance is Return — confirm/menu do too); every
  // other action is swallowed so nothing reaches the home underneath.
  //
  // Ordering matters: this is a LAYOUT effect so it claims before any player's
  // passive-effect claim in the same commit, keeping the player on TOP of the
  // stack (layout effects all run before passive effects; releases are
  // identity-based, so no ordering can pop the wrong owner — exclusiveStack).
  const { claimExclusive } = useController();
  const requestExitRef = useRef(requestExit);
  requestExitRef.current = requestExit;
  useLayoutEffect(() => {
    const handler = (action: SemanticAction) => {
      if (isExternal) {
        // Return-to-library is the external surface's single affordance.
        if (action === "confirm" || action === "back" || action === "menu") {
          requestExitRef.current();
        }
        return;
      }
      // In-page/native boot gap or the get-core panel: back backs out of the
      // takeover; everything else is deliberately eaten.
      if (action === "back") requestExitRef.current();
    };
    return claimExclusive(handler, "ui");
  }, [isExternal, claimExclusive]);

  // The cover's from-state (initial): the tile rect it grows out of (so the very
  // first paint is anchored to the tile the user launched from), or the filled
  // geometry when there is no source rect.
  const coverInitial = useMemo(
    () => ({ ...tileGeometry(state.originRect), opacity: 1 }),
    [state.originRect],
  );
  const coverAnimate = coverTarget(state.originRect, state.phase);

  // When the collapse animation lands, hand control back to the home. Framer
  // fires onAnimationComplete for the target we animate to; we only care about
  // the collapse's completion, so guard on the collapsing phase.
  const onCoverAnimationComplete = useCallback(() => {
    if (state.phase === "collapsing") onExited();
  }, [state.phase, onExited]);

  // A safety net: if there is no cover layer to animate to completion (art never
  // resolved) OR reduced motion zeroes the duration so no animation event fires,
  // still finish the exit shortly after the collapse begins.
  useEffect(() => {
    if (state.phase !== "collapsing") return;
    if (coverArt && !reducedMotion) return; // the cover's onAnimationComplete will fire
    const id = window.setTimeout(onExited, 0);
    return () => window.clearTimeout(id);
  }, [state.phase, coverArt, reducedMotion, onExited]);

  return (
    // A plain container (not an animated one): all the motion lives in the cover
    // (expand/crossfade/collapse) and the player's reveal fade, so the surface
    // itself needs no entry/exit animation — the expanding cover IS its entrance,
    // and the collapse-then-unmount (driven by `onExited`) is its exit. Adding a
    // surface-level AnimatePresence fade here would double the motion and would
    // not even fire (the surface is not a direct AnimatePresence child).
    <div className="rgp-tv-game-surface" data-testid="tv-game-surface" data-phase={state.phase}>
      {/* The live player (or branded external surface) sits UNDERNEATH the cover,
          booting while the art expands. Kept visually hidden until uncovered so
          a mid-boot flash never peeks around the expanding art edges. */}
      <div className="rgp-tv-game-surface__player" data-uncovered={playerVisible ? "true" : undefined}>
        {isExternal ? (
          <TvExternalSurface game={game} onReturn={requestExit} launch={launchGame} />
        ) : (
          <PlaySwitch
            gameId={game.id}
            system={game.system}
            gameName={game.cleanName}
            presentation="takeover"
            onExit={requestExit}
          />
        )}
      </div>

      {/* The expanding/collapsing cover art — a single persistent layer (mounted
          for the surface's whole life so there is no mount race between phases)
          that animates through expand → crossfade-out (revealed: opacity 0, still
          positioned filled) → (on exit) crossfade-in + collapse to the tile. The
          `revealed` state leaves it invisible but still filled, so the collapse
          slides cleanly from fullscreen back to the tile. `pointer-events: none`
          (CSS) keeps the invisible layer from eating input while the game plays. */}
      {coverArt && (
        <motion.div
          className="rgp-tv-game-surface__cover"
          data-visible={coverVisible ? "true" : undefined}
          style={{ backgroundImage: `url("${coverArt}")` }}
          initial={coverInitial}
          animate={coverAnimate}
          transition={{ duration: DUR.slow, ease: EASE_OUT }}
          onAnimationComplete={onCoverAnimationComplete}
          aria-hidden
        />
      )}
    </div>
  );
}
