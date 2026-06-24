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
import { NavLink, Route, Routes } from "react-router-dom";
import { AuraApp } from "@aura/react";
import { isAppError, ping } from "./ipc/commands";
import { HARMONY_ROUTES } from "./routes";
import { ControllerProvider, HintBar } from "./features/controller";

// Left inset reserves room for the native traffic-light controls so the top bar
// content never renders under them (D2 §5: ~78x28pt controls → 72-80px inset).
const TRAFFIC_LIGHT_INSET_PX = 80;
const DRAG_STRIP_HEIGHT_PX = 36;
const SIDEBAR_WIDTH_PX = 220;

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
        fontSize: 12,
        padding: "6px 10px",
        borderRadius: 8,
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
        width: SIDEBAR_WIDTH_PX,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <h1 style={{ fontSize: 18, margin: "4px 8px 16px" }}>Harmony</h1>
      {HARMONY_ROUTES.filter((r) => r.navLabel).map((r) => (
        <NavLink
          key={r.path}
          to={r.path}
          end={r.index}
          style={({ isActive }) => ({
            padding: "8px 10px",
            borderRadius: 8,
            textDecoration: "none",
            color: isActive
              ? "var(--aura-on-primary)"
              : "var(--aura-on-surface)",
            background: isActive ? "var(--aura-primary)" : "transparent",
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

function App() {
  return (
    // AuraApp is the app-shell archetype root; it paints transparent so vibrancy
    // reads through (theme/aura-theme.css). The wrapper bridges React to the
    // custom element's events/class contract (design-language.md §7.2).
    // ControllerProvider owns spatial focus + gamepad polling so the whole app
    // is navigable by controller alone (W14). The persistent HintBar footer
    // shows the focused context's button hints; screens supply their own hints
    // via a nested <HintBar> when they need richer context.
    <ControllerProvider>
      <AuraApp className="harmony-shell" style={{ display: "block", minHeight: "100vh" }}>
        <div
          data-tauri-drag-region
          style={{
            height: DRAG_STRIP_HEIGHT_PX,
            paddingLeft: TRAFFIC_LIGHT_INSET_PX,
            width: "100%",
          }}
        />
        <div style={{ display: "flex", minHeight: `calc(100vh - ${DRAG_STRIP_HEIGHT_PX}px)` }}>
          <Sidebar />
          <main
            style={{
              flex: 1,
              padding: 24,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flex: 1 }}>
              <Routes>
                {HARMONY_ROUTES.map((r) => (
                  <Route key={r.path} path={r.path} element={r.element} />
                ))}
              </Routes>
            </div>
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
    </ControllerProvider>
  );
}

export default App;
