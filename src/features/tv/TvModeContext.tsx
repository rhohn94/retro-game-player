// TvModeProvider — the mode model for TV/leanback mode (v0.26 W260,
// tv-mode-design.md §Design "Mode model"). Owns `{ active, enter(), exit() }`:
// entering couples to OS fullscreen (`useFullscreen`) and remembers the
// current desktop route + fullscreen state so exit can restore both exactly.
// No "last state" is persisted across launches — only the `auto_tv_mode`
// AppConfig flag governs what happens at startup (App.tsx reads it once and
// calls `enter()`), matching the design doc's explicit non-goal of persisting
// TV mode across restarts.
//
// Mounted once in App.tsx, inside the router (it needs `useNavigate`/
// `useLocation` to snapshot + restore the desktop route) and inside
// `ControllerProvider` (the menu long-press entry affordance is wired via
// `useTvModeControllerToggle`, a small hook colocated in this module so the
// provider file stays the single place mode-transition side effects happen).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { UseFullscreenResult } from "../shell/useFullscreen";
import type { Game } from "../../ipc/library";
import type { TileRect } from "./tvTakeover";

/** A game launched into the in-TV takeover: the game plus the originating tile
 * rect the takeover expands from / collapses back to (null when launched from a
 * non-tile affordance — a centred plain crossfade). */
export interface TvLaunch {
  game: Game;
  originRect: TileRect | null;
}

/** The TV-mode context surface: current state plus the transitions. */
export interface TvModeContextValue {
  /** Whether TV mode is currently active (the shell renders `<TvShell/>`). */
  active: boolean;
  /** Enter TV mode: goes OS-fullscreen and remembers the current route so
   * `exit()` can restore it. No-op if already active. */
  enter: () => void;
  /** Exit TV mode: restores the fullscreen state captured at `enter()` time
   * and navigates back to the route that was active before entering. No-op
   * if not active. */
  exit: () => void;
  /**
   * Launch a game from TV home into the in-TV fullscreen takeover (v0.26 W265).
   * This is the SINGLE launch seam the TV home routes every tile/hero activation
   * through. Rather than navigating to the desktop detail route (the W261
   * behaviour this replaced), it sets `launched` so `TvShell` renders
   * `<TvGameSurface/>` — the game boots INSIDE TV mode with the shared-layout
   * takeover animation, and exiting collapses back to the originating tile with
   * the home's focus intact. TV mode stays active throughout.
   */
  launch: (game: Game, originRect: TileRect | null) => void;
  /** The game currently taken over to (via `launch`), or null when the home is
   * showing. `TvShell` reads this to decide whether to render the game surface. */
  launched: TvLaunch | null;
  /** End the takeover: drop the launched game and return to the home. Called
   * once the exit-collapse animation completes (TvGameSurface.onExited). */
  endLaunch: () => void;
}

const TvModeContext = createContext<TvModeContextValue | null>(null);

/** Read the TV-mode context; throws if used outside `<TvModeProvider>`. */
export function useTvMode(): TvModeContextValue {
  const ctx = useContext(TvModeContext);
  if (!ctx) throw new Error("useTvMode must be used within a TvModeProvider");
  return ctx;
}

/**
 * Owns TV-mode's active/inactive state and the enter/exit transitions. Must be
 * mounted inside the router (needs the current location) and is expected to
 * sit alongside `useFullscreen`'s owner so entering/exiting couples window
 * fullscreen to the mode switch (tv-mode-design.md: "Entering TV mode also
 * enters OS fullscreen; exiting restores").
 */
export function TvModeProvider({
  fullscreen,
  children,
}: {
  fullscreen: UseFullscreenResult;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);
  // The in-TV takeover target (v0.26 W265) — null while the home is showing.
  const [launched, setLaunched] = useState<TvLaunch | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Snapshot the desktop route + fullscreen state at the moment TV mode is
  // entered, so exit() restores exactly what was there before — a stale ref
  // (rather than state) since neither read needs to trigger a re-render.
  const priorRouteRef = useRef<string>("/");
  const priorFullscreenRef = useRef(false);
  const locationRef = useRef(location);
  locationRef.current = location;

  const enter = useCallback(() => {
    setActive((wasActive) => {
      if (wasActive) return wasActive;
      priorRouteRef.current = locationRef.current.pathname + locationRef.current.search;
      priorFullscreenRef.current = fullscreen.isFullscreen;
      fullscreen.setFullscreen(true);
      return true;
    });
  }, [fullscreen]);

  const exit = useCallback(() => {
    setActive((wasActive) => {
      if (!wasActive) return wasActive;
      fullscreen.setFullscreen(priorFullscreenRef.current);
      navigate(priorRouteRef.current);
      return false;
    });
    // Leaving TV mode entirely also drops any in-flight takeover.
    setLaunched(null);
  }, [fullscreen, navigate]);

  // Launch a game into the in-TV takeover (W265): TV mode stays active; TvShell
  // renders the game surface over the home. The home stays mounted behind it, so
  // its per-rail focus memory + scroll position survive for the exit collapse.
  const launch = useCallback((game: Game, originRect: TileRect | null) => {
    setLaunched({ game, originRect });
  }, []);

  // End the takeover and return to the home (called when the exit collapse
  // completes). TV mode itself stays active.
  const endLaunch = useCallback(() => setLaunched(null), []);

  const value = useMemo<TvModeContextValue>(
    () => ({ active, enter, exit, launch, launched, endLaunch }),
    [active, enter, exit, launch, launched, endLaunch],
  );

  return <TvModeContext.Provider value={value}>{children}</TvModeContext.Provider>;
}
