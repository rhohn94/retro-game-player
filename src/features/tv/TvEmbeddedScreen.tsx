// TvEmbeddedScreen — renders a real desktop screen inside the TvShell outlet
// in place of TvHome (v0.28 W278, tv-mode-design.md §v0.28 → W278 "Every page
// in TV mode"). TV mode + fullscreen stay active throughout; only the outlet's
// content swaps.
//
// Reuses the SAME route table (`HARMONY_ROUTES`) and the SAME `<Routes>`/
// `<Route>` resolution `RoutedOutlet` (App.tsx) uses on the desktop, driven by
// the real router location — so deep links with params (`/console/:key`,
// `/game/:id`) resolve exactly as they do on the desktop, and any in-screen
// navigation (e.g. Consoles -> a console's own detail link) just works without
// this component needing to know about it. `TvModeContext.enterEmbedded`
// already pushed the router to the destination path before this mounts.
//
// Wrapped in a single uniform 10-foot scale-up (`.rgp-tv-embed`, CSS `zoom` —
// tv.css `--rgp-tv-embed-scale`) rather than per-screen restyling (release-
// plan contract: "one knob, not per-screen restyling"); `zoom` (unlike
// `transform: scale`) keeps layout math in scaled coordinates, so the base
// spatial engine's `getBoundingClientRect` reads, native scroll-into-view, and
// hit-testing all keep working unmodified.
//
// `back` at this screen's top level returns to TV home: registered as the
// screen-level action handler (`setActionHandlers`), the same seam the
// desktop shell's `ShellControllerBindings` uses for its own global `back` ->
// `navigate(-1)` binding — but there is no exclusive claim installed here
// (unlike TvHome), so the base spatial engine still drives nav_*/confirm for
// whatever the embedded screen itself registers via useFocusable, exactly as
// it does on the desktop. Known v1 edge (recorded, not solved): a screen's
// OWN "back to parent list" affordances (e.g. ConsoleDetailPage's own back
// button) are separate on-screen controls, not this semantic `back` action —
// so `back` always returns to TV home rather than un-nesting one level within
// the embedded region first (tv-mode-design.md §Follow-ups).

import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { HARMONY_ROUTES } from "../../routes";
import { useController } from "../controller";
import { useTvMode } from "./TvModeContext";

export function TvEmbeddedScreen() {
  const location = useLocation();
  const { setActionHandlers } = useController();
  const { returnToHome } = useTvMode();

  useEffect(() => {
    setActionHandlers({ back: returnToHome });
    return () => setActionHandlers({});
  }, [setActionHandlers, returnToHome]);

  return (
    <div className="rgp-tv-embed" data-testid="tv-embed">
      <Routes location={location}>
        {HARMONY_ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
      </Routes>
    </div>
  );
}
