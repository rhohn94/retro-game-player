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

/** The TV-mode context surface: current state plus the two transitions. */
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
  }, [fullscreen, navigate]);

  const value = useMemo<TvModeContextValue>(
    () => ({ active, enter, exit }),
    [active, enter, exit],
  );

  return <TvModeContext.Provider value={value}>{children}</TvModeContext.Provider>;
}
