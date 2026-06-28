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
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { AuraApp } from "@aura/react";
import { isAppError, ping } from "./ipc/commands";
import { HARMONY_ROUTES } from "./routes";
import { pageTransition } from "./lib/motion";
import { ControllerProvider, HintBar } from "./features/controller";

// Shell geometry (sidebar width, drag-strip height, the native traffic-light
// inset — D2 §5) lives as `--harmony-*` tokens in theme/aura-theme.css so the
// shell is token-driven like every other surface (v0.3 W32).

/** IPC liveness chip — round-trips `ping` so the shell proves the seam works. */
function IpcStatus() {
  const [pong, setPong] = useState<string>("…");

  useEffect(() => {
    let cancelled = false;
    ping()
      .then((reply) => {
        if (!cancelled) setPong(reply);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const detail = isAppError(err) ? err.detail : String(err);
        setPong(`ping failed: ${detail}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="harmony-panel"
      style={{
        fontSize: "var(--harmony-font-chip)",
        padding: "var(--harmony-chip-pad-sm)",
        borderRadius: "var(--aura-radius-sm)",
        color: "var(--aura-on-surface-muted)",
      }}
      title="Backend IPC round-trip"
    >
      IPC: {pong}
    </div>
  );
}

/** The translucent primary navigation, built from the route table's nav entries. */
function Sidebar() {
  return (
    <nav
      className="harmony-sidebar"
      style={{
        width: "var(--harmony-sidebar-width)",
        padding: "var(--aura-space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--aura-space-1)",
      }}
    >
      <h1
        style={{
          fontSize: "var(--harmony-font-title)",
          margin: "var(--aura-space-1) var(--aura-space-2) var(--aura-space-4)",
        }}
      >
        Harmony
      </h1>
      {HARMONY_ROUTES.filter((r) => r.navLabel).map((r) => (
        <NavLink
          key={r.path}
          to={r.path}
          end={r.index}
          style={({ isActive }) => ({
            padding: "var(--aura-space-2) var(--harmony-space-2-5)",
            borderRadius: "var(--aura-radius-sm)",
            textDecoration: "none",
            color: isActive
              ? "var(--aura-on-primary)"
              : "var(--aura-on-surface)",
            background: isActive ? "var(--aura-primary)" : "transparent",
            transition:
              "background var(--harmony-dur-fast) var(--harmony-ease-out), color var(--harmony-dur-fast) var(--harmony-ease-out)",
          })}
        >
          {r.navLabel}
        </NavLink>
      ))}
      <div style={{ marginTop: "auto" }}>
        <IpcStatus />
      </div>
    </nav>
  );
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

function App() {
  return (
    // AuraApp is the app-shell archetype root; it paints transparent so vibrancy
    // reads through (theme/aura-theme.css). The wrapper bridges React to the
    // custom element's events/class contract (design-language.md §7.2).
    // ControllerProvider owns spatial focus + gamepad polling so the whole app
    // is navigable by controller alone (W14). The persistent HintBar footer
    // shows the focused context's button hints; screens supply their own hints
    // via a nested <HintBar> when they need richer context.
    // MotionConfig reducedMotion="user" makes every Framer animation in the app
    // honour the OS "reduce motion" setting from one place (the CSS side is
    // handled by the media query in theme/motion.css).
    <ControllerProvider>
      <MotionConfig reducedMotion="user">
      <AuraApp className="harmony-shell" style={{ display: "block", minHeight: "100vh" }}>
        <div
          data-tauri-drag-region
          style={{
            height: "var(--harmony-drag-strip-height)",
            paddingLeft: "var(--harmony-traffic-light-inset)",
            width: "100%",
          }}
        />
        <div
          style={{
            display: "flex",
            minHeight: "calc(100vh - var(--harmony-drag-strip-height))",
          }}
        >
          <Sidebar />
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
      </MotionConfig>
    </ControllerProvider>
  );
}

export default App;
