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
  /**
   * W278 system menu: whether the overlay is currently open. `TvShell` renders
   * `<TvSystemMenu/>` above whatever the outlet shows while true.
   */
  menuOpen: boolean;
  /** Open the system menu (Select/touchpad trigger, or the pointer ☰ button). */
  openMenu: () => void;
  /** Close the system menu without navigating (back/Select-again, or a
   * destination pick already calls its own transition — see enterEmbedded/
   * returnToHome — so this is for the "just dismiss" case). */
  closeMenu: () => void;
  /**
   * W278 "every page in TV mode": the desktop route currently embedded in the
   * TvShell outlet in place of `TvHome`, or null while the home is showing.
   * Deliberately NOT the same thing as the router's live location — TV mode's
   * own navigation (`enterEmbedded`) DOES drive the real router (so
   * `HARMONY_ROUTES`' elements + deep links render for real, and in-screen
   * navigation like "Consoles -> a console detail" just works), but this flag
   * is the single source of truth for "is the outlet showing the embedded
   * region at all" — the router's `location.pathname` alone can't answer that
   * ("/" is BOTH the desktop Library route and "no embedded screen, show TV
   * home"). Kept independent of `priorRouteRef`/`exit()`'s snapshot-restore
   * contract: entering/leaving the embedded region never re-snapshots or
   * touches `priorRouteRef`, so exiting TV mode after any amount of in-TV
   * navigation still restores the ORIGINAL pre-enter desktop route (see
   * `enterEmbedded`/`exit`'s implementation comments).
   */
  embeddedPath: string | null;
  /** Navigate into the embedded desktop-screen region (a HARMONY_ROUTES path
   * picked from the system menu, or a deep link a screen navigates to while
   * embedded). Closes the menu if open. */
  enterEmbedded: (path: string) => void;
  /** Return to TV home from the embedded region ("back" at its top level, or
   * the menu's "TV Home" entry). Does NOT touch router location — TvHome
   * reads no location state, so simply hiding the embedded region is enough;
   * the next `enterEmbedded` call navigates fresh. */
  returnToHome: () => void;
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
  // W278 system menu + embedded-screen state — independent of `launched`
  // (the menu never opens over a takeover; see useMenuTrigger's gating) and
  // independent of `priorRouteRef` (below): neither is touched by entering/
  // leaving the embedded region, only by enter()/exit() themselves.
  const [menuOpen, setMenuOpen] = useState(false);
  const [embeddedPath, setEmbeddedPath] = useState<string | null>(null);
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
      // Restore the EXACT pre-enter route, regardless of any in-TV navigation
      // (W278 embedded screens) that ran meanwhile: priorRouteRef is written
      // only once, inside enter()'s `!wasActive` branch, and enterEmbedded/
      // returnToHome never touch it — so this navigate() always lands back on
      // the route that was active before TV mode was entered, never on
      // whatever embedded screen the menu last showed.
      navigate(priorRouteRef.current);
      return false;
    });
    // Leaving TV mode entirely also drops any in-flight takeover and the W278
    // menu/embedded-screen state, so a later enter() always starts fresh on
    // the TV home rather than resuming wherever in-TV navigation left off.
    setLaunched(null);
    setMenuOpen(false);
    setEmbeddedPath(null);
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

  // ── W278 system menu + embedded screens ──────────────────────────────────
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Navigate into the embedded region. This DOES drive the real router (so
  // HARMONY_ROUTES' real elements + deep links render), but deliberately does
  // NOT touch priorRouteRef — that ref is exit()'s one-shot restore target,
  // written only at enter() time, so any number of enterEmbedded calls before
  // exit() can never corrupt the pre-enter snapshot.
  const enterEmbedded = useCallback(
    (path: string) => {
      navigate(path);
      setEmbeddedPath(path);
      setMenuOpen(false);
    },
    [navigate],
  );

  // Return to TV home: just hides the embedded region (TvHome reads no router
  // state, so nothing needs to navigate). The router's location is left as-is
  // until either another enterEmbedded call or exit()'s own restore.
  const returnToHome = useCallback(() => setEmbeddedPath(null), []);

  const value = useMemo<TvModeContextValue>(
    () => ({
      active,
      enter,
      exit,
      launch,
      launched,
      endLaunch,
      menuOpen,
      openMenu,
      closeMenu,
      embeddedPath,
      enterEmbedded,
      returnToHome,
    }),
    [
      active,
      enter,
      exit,
      launch,
      launched,
      endLaunch,
      menuOpen,
      openMenu,
      closeMenu,
      embeddedPath,
      enterEmbedded,
      returnToHome,
    ],
  );

  return <TvModeContext.Provider value={value}>{children}</TvModeContext.Provider>;
}
