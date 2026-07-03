// TvExternalSurface — the takeover surface for EXTERNAL (RetroArch-only) systems
// inside TV mode (v0.26 W265, tv-mode-design.md §Design "Transitions": "external
// RetroArch gets the takeover to a branded 'Running in RetroArch' TV surface with
// a Return affordance"). Systems with no in-page/native player can't run inside
// the app, so — matching the desktop external path's honesty — the takeover lands
// on a branded panel that says the game is running in RetroArch (a separate
// window) and offers a big, 10-foot Return control back to the home.
//
// It spawns the external launch itself (on mount, exactly once) so the takeover
// is a single seam: confirm on the tile → takeover expands → this surface fires
// the launch. Launch state is reported honestly (launching / running / failed)
// rather than pretending an external process is embedded.

import { useEffect, useRef, useState } from "react";
import type { Game } from "../../ipc/library";
import { useFocusable } from "../controller";
import "./tv-external-surface.css";

/** The external launch's progression, surfaced honestly on the panel. */
type LaunchState = "launching" | "running" | "failed";

export interface TvExternalSurfaceProps {
  /** The game being launched externally. */
  game: Game;
  /** Return to the TV home (collapse the takeover). */
  onReturn: () => void;
  /** The launch IPC — injected so the surface is unit-testable without Tauri.
   * Defaults to the real `launchGame` when TvGameSurface wires it. Launches
   * fullscreen (the couch expects the game to fill the TV). */
  launch: (gameId: number, fullscreen?: boolean) => Promise<void>;
}

/** The branded external-play surface. Fires the launch on mount, then invites
 * the user to return when they're done in RetroArch. */
export function TvExternalSurface({ game, onReturn, launch }: TvExternalSurfaceProps) {
  const [launchState, setLaunchState] = useState<LaunchState>("launching");

  // Fire the external launch exactly once on mount. A one-shot ref guard (not a
  // dependency array alone) so a StrictMode double-invoke or a re-render never
  // spawns a second RetroArch process.
  const launchedRef = useRef(false);
  useEffect(() => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    let cancelled = false;
    launch(game.id, true)
      .then(() => !cancelled && setLaunchState("running"))
      .catch(() => !cancelled && setLaunchState("failed"));
    return () => {
      cancelled = true;
    };
  }, [game.id, launch]);

  // The Return control is the surface's single focus target so the controller
  // lands on it immediately (confirm returns to the home). Mirror controller
  // focus to DOM focus for the ring, matching the tiles/hero.
  const { ref, isFocused, focus } = useFocusable<HTMLButtonElement>(
    "tv-external:return",
    onReturn,
  );
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);

  const statusLine =
    launchState === "launching"
      ? "Launching in RetroArch…"
      : launchState === "running"
        ? "Running in RetroArch"
        : "RetroArch could not start";

  return (
    <div className="rgp-tv-external" data-testid="tv-external-surface" data-state={launchState}>
      <div className="rgp-tv-external__content">
        <p className="rgp-tv-external__eyebrow">External play</p>
        <h1 className="rgp-tv-external__title">{game.cleanName}</h1>
        <p className="rgp-tv-external__status" role="status">
          {statusLine}
        </p>
        <p className="rgp-tv-external__hint">
          {launchState === "failed"
            ? "Check that RetroArch is installed and a core is configured for this system."
            : "This game plays in a separate RetroArch window. Return here when you're done."}
        </p>
        <button
          ref={ref}
          type="button"
          className="rgp-tv-external__return"
          data-focused={isFocused ? "true" : undefined}
          onFocus={focus}
          onMouseEnter={focus}
          onClick={onReturn}
        >
          ◀ Return to library
        </button>
      </div>
    </div>
  );
}
