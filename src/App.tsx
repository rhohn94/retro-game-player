// AuraApp shell + router (architecture-design.md §1.1, harmony-ux-design.md §0).
// W2 replaces the W1 ping placeholder with the Aura app-shell archetype: a
// persistent `<aura-app>` frame wrapping a translucent sidebar (OKLCH-alpha so
// native vibrancy shows through — NO backdrop-filter) and the routed screen.
// The `ping` IPC round-trip is kept wired as a status indicator so end-to-end
// IPC still proves out. Later items mount the HeroBackdrop + HintBar here.
//
// The top strip carries `data-tauri-drag-region` so the frameless window
// (titleBarStyle "Overlay" + hiddenTitle, D2 §1/§5) can be dragged. Interactive
// children must NOT inherit the drag region — keep controls off the strip.
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { AuraApp } from "@aura/react";
import { isAppError, ping } from "./ipc/commands";
import { HARMONY_ROUTES, type HarmonyRoute } from "./routes";
import { pageTransition } from "./lib/motion";
import { ControllerProvider, HintBar, useController, useFocusable } from "./features/controller";
import { useFullscreen, type UseFullscreenResult } from "./features/shell/useFullscreen";
import { useCancellableEffect } from "./hooks/useCancellableEffect";
import {
  TvHome,
  TvModeProvider,
  TvShell,
  useAutoTvModeOnStartup,
  useTvMode,
  useTvModeControllerToggle,
} from "./features/tv";

// Shell geometry (sidebar width, drag-strip height, the native traffic-light
// inset — D2 §5) lives as `--rgp-*` tokens in theme/aura-theme.css so the
// shell is token-driven like every other surface (v0.3 W32).

/** IPC liveness chip — round-trips `ping` so the shell proves the seam works. */
function IpcStatus() {
  const [pong, setPong] = useState<string>("…");

  useCancellableEffect((isCancelled) => {
    ping()
      .then((reply) => {
        if (!isCancelled()) setPong(reply);
      })
      .catch((err: unknown) => {
        if (isCancelled()) return;
        const detail = isAppError(err) ? err.detail : String(err);
        setPong(`ping failed: ${detail}`);
      });
  }, []);

  return (
    <div
      className="rgp-panel"
      style={{
        fontSize: "var(--rgp-font-chip)",
        padding: "var(--rgp-chip-pad-sm)",
        borderRadius: "var(--aura-radius-sm)",
        color: "var(--aura-on-surface-muted)",
      }}
      title="Backend IPC round-trip"
    >
      IPC: {pong}
    </div>
  );
}

/**
 * A primary-nav item registered as a controller focus target. When the controller
 * moves focus here, we mirror it to native DOM focus (`ref.focus()`) so the item
 * scrolls into view and shows the ring; `confirm` navigates to the route.
 */
function FocusableNavItem({ route }: { route: HarmonyRoute }) {
  const navigate = useNavigate();
  const { ref, isFocused } = useFocusable<HTMLAnchorElement>(`nav:${route.path}`, () =>
    navigate(route.path),
  );
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);
  return (
    <NavLink
      ref={ref}
      to={route.path}
      end={route.index}
      style={({ isActive }) => ({
        padding: "var(--aura-space-2) var(--rgp-space-2-5)",
        borderRadius: "var(--aura-radius-sm)",
        textDecoration: "none",
        color: isActive ? "var(--aura-on-primary)" : "var(--aura-on-surface)",
        background: isActive ? "var(--aura-primary)" : "transparent",
        outline: isFocused ? "2px solid var(--aura-focus)" : "none",
        outlineOffset: "2px",
        transition:
          "background var(--rgp-dur-fast) var(--rgp-ease-out), color var(--rgp-dur-fast) var(--rgp-ease-out)",
      })}
    >
      {route.navLabel}
    </NavLink>
  );
}

/** Focusable fullscreen toggle in the sidebar footer (also bound to F11). */
function FullscreenButton({ fullscreen }: { fullscreen: UseFullscreenResult }) {
  const { ref, isFocused } = useFocusable<HTMLButtonElement>(
    "shell:fullscreen",
    fullscreen.toggle,
  );
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={fullscreen.toggle}
      className="rgp-panel"
      title="Toggle fullscreen (F11)"
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        fontSize: "var(--rgp-font-chip)",
        padding: "var(--rgp-chip-pad-sm)",
        borderRadius: "var(--aura-radius-sm)",
        color: "var(--aura-on-surface)",
        border: "none",
        outline: isFocused ? "2px solid var(--aura-focus)" : "none",
        outlineOffset: "2px",
      }}
    >
      {fullscreen.isFullscreen ? "⤡ Exit full screen" : "⤢ Full screen"}
    </button>
  );
}

/** Focusable TV-mode entry button in the sidebar footer (also bound to Cmd+T). */
function TvModeButton() {
  const { enter } = useTvMode();
  const { ref, isFocused } = useFocusable<HTMLButtonElement>("shell:tv-mode", enter);
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={enter}
      className="rgp-panel"
      title="Enter TV mode (Cmd+T)"
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        fontSize: "var(--rgp-font-chip)",
        padding: "var(--rgp-chip-pad-sm)",
        borderRadius: "var(--aura-radius-sm)",
        color: "var(--aura-on-surface)",
        border: "none",
        outline: isFocused ? "2px solid var(--aura-focus)" : "none",
        outlineOffset: "2px",
      }}
    >
      📺 TV mode
    </button>
  );
}

/** The translucent primary navigation, built from the route table's nav entries. */
function Sidebar({ fullscreen }: { fullscreen: UseFullscreenResult }) {
  return (
    <nav
      className="rgp-sidebar"
      style={{
        width: "var(--rgp-sidebar-width)",
        padding: "var(--aura-space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--aura-space-1)",
      }}
    >
      <h1
        style={{
          fontSize: "var(--rgp-font-title)",
          margin: "var(--aura-space-1) var(--aura-space-2) var(--aura-space-4)",
        }}
      >
        Retro Game Player
      </h1>
      {HARMONY_ROUTES.filter((r) => r.navLabel).map((r) => (
        <FocusableNavItem key={r.path} route={r} />
      ))}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--aura-space-2)",
        }}
      >
        <TvModeButton />
        <FullscreenButton fullscreen={fullscreen} />
        <IpcStatus />
      </div>
    </nav>
  );
}

/**
 * Wires app-level controller actions: `back` navigates to the previous screen so
 * the controller's B button always backs out. Registered once at shell mount.
 */
function ShellControllerBindings() {
  const { setActionHandlers, setFocus } = useController();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    setActionHandlers({ back: () => navigate(-1) });
  }, [setActionHandlers, navigate]);
  // A route change leaves the outgoing screen's focus id behind — the next
  // screen's own elements re-claim focus as they register (ControllerProvider's
  // register()), but nothing cleared the stale id in between, so a mid-crossfade
  // frame (or a screen with no focusables) could keep showing a foreign ring
  // (W221, controller-input-design.md).
  useEffect(() => {
    setFocus(null);
  }, [location.pathname, setFocus]);
  return null;
}

/**
 * The routed content area, animated. Each route is keyed by pathname so
 * AnimatePresence (mode="wait") fades the outgoing screen out before the
 * incoming one fades in — a quiet crossfade that gives navigation continuity
 * without getting in the user's way. `Routes` is given the same `location` so it
 * keeps rendering the outgoing element through its exit animation.
 */
function RoutedOutlet() {
  const location = useLocation();
  return (
    <div style={{ flex: 1, position: "relative" }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          style={{ height: "100%" }}
          initial={pageTransition.initial}
          animate={pageTransition.animate}
          exit={pageTransition.exit}
        >
          <Routes location={location}>
            {HARMONY_ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Routes>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Cmd+T (or Ctrl+T off-macOS) toggles TV mode from anywhere in the desktop
 * shell (tv-mode-design.md §Design "Mode model": sidebar button / Cmd+T /
 * controller menu long-press are the three entry affordances). Registered
 * once at the shell so it works regardless of which route/focus has the
 * page — matches F11's existing app-wide binding in `useFullscreen`. */
function useTvModeAccelerator() {
  const { active, enter, exit } = useTvMode();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        if (active) exit();
        else enter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, enter, exit]);
}

/**
 * The desktop app shell: sidebar + routed content. Owns the app-level
 * controller bindings; the fullscreen toggle (F11 + sidebar button) is passed
 * in rather than owned here because `TvModeProvider` needs the SAME
 * fullscreen instance (entering TV mode calls `fullscreen.setFullscreen`,
 * and exiting restores whatever state was captured) — see `App` below.
 * Rendered while TV mode is inactive; TvShell takes over the full viewport
 * instead while it's active (see `Root` below) — the desktop route tree
 * unmounts rather than staying mounted-behind, so its own gamepad-focus
 * registrations and IPC polls don't keep running invisibly under the TV
 * surface (documented deviation from a "stays mounted behind" reading of the
 * design doc; TV mode's own exit restores the exact prior route via
 * `TvModeProvider`'s route snapshot, so nothing is lost by unmounting).
 */
function Shell({ fullscreen }: { fullscreen: UseFullscreenResult }) {
  return (
    // AuraApp is the app-shell archetype root; it paints transparent so vibrancy
    // reads through (theme/aura-theme.css). The wrapper bridges React to the
    // custom element's events/class contract (design-language.md §7.2).
    <AuraApp className="rgp-shell" style={{ display: "block", minHeight: "100vh" }}>
      <ShellControllerBindings />
      <div
        data-tauri-drag-region
        style={{
          height: "var(--rgp-drag-strip-height)",
          paddingLeft: "var(--rgp-traffic-light-inset)",
          width: "100%",
        }}
      />
      <div
        style={{
          display: "flex",
          minHeight: "calc(100vh - var(--rgp-drag-strip-height))",
        }}
      >
        <Sidebar fullscreen={fullscreen} />
        <main
          style={{
            flex: 1,
            padding: "var(--aura-space-5)",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <RoutedOutlet />
          <HintBar
            hints={[
              { action: "confirm", label: "Select" },
              { action: "back", label: "Back" },
              { action: "menu", label: "Menu" },
            ]}
          />
        </main>
      </div>
    </AuraApp>
  );
}

/**
 * Switches between the desktop `Shell` and the full-viewport `TvShell` based
 * on TV-mode's active state; wires the startup auto-enter read and the
 * controller menu long-press toggle. Split out from `App` so `TvModeProvider`
 * (mounted just above it) is already in scope.
 */
function Root({ fullscreen }: { fullscreen: UseFullscreenResult }) {
  const tvMode = useTvMode();
  useTvModeAccelerator();
  useAutoTvModeOnStartup(tvMode);
  useTvModeControllerToggle();

  return (
    <AnimatePresence mode="wait">
      {tvMode.active ? (
        <TvShell key="tv" onExit={tvMode.exit}>
          <TvHome onExit={tvMode.exit} />
        </TvShell>
      ) : (
        <Shell key="desktop" fullscreen={fullscreen} />
      )}
    </AnimatePresence>
  );
}

function App() {
  // Hoisted above both Shell and TvModeProvider so entering/exiting TV mode
  // and the desktop sidebar's fullscreen button drive the SAME window state
  // (tv-mode-design.md: "Entering TV mode also enters OS fullscreen; exiting
  // restores").
  const fullscreen = useFullscreen();
  return (
    // ControllerProvider owns spatial focus + gamepad polling so the whole app
    // is navigable by controller alone (W14, wired into the shell + library in
    // v0.14). MotionConfig reducedMotion="user" makes every Framer animation
    // honour the OS "reduce motion" setting from one place (the CSS side is the
    // media query in theme/motion.css). TvModeProvider sits inside the router
    // (via HashRouter in main.tsx) so it can snapshot/restore the desktop route.
    <ControllerProvider>
      <MotionConfig reducedMotion="user">
        <TvModeProvider fullscreen={fullscreen}>
          <Root fullscreen={fullscreen} />
        </TvModeProvider>
      </MotionConfig>
    </ControllerProvider>
  );
}

export default App;
