// TvShell — the full-viewport leanback chrome TV mode renders instead of the
// desktop sidebar+content tree (v0.26 W260 foundation; W261 fills the outlet
// with the real TV home). TvShell owns the CHROME (full-bleed backdrop,
// 5%-overscan safe-area frame, pointer exit/menu affordances) and renders its
// `children` — the real `<TvHome/>` (or, since v0.28 W278, an embedded
// desktop screen — see `Root` in App.tsx) from `Root` — into a marked outlet
// region.
//
// Controller `back` + the "press Back again to exit" confirm gesture are owned
// by the mounted home content (TvHome installs the controller's EXCLUSIVE
// handler and drives its own two-press exit-confirm via useTvExitConfirm), NOT
// by this shell: an exclusive handler takes priority over any screen-level
// `setActionHandlers`, so a `back` handler here would be dead while a home is
// mounted. TvShell therefore keeps only the POINTER exit + (since W278) POINTER
// menu affordances (the visible buttons); the controller-driven confirm/menu
// gestures live with whoever owns the exclusive handler at the time (TvHome,
// an embedded screen, or — while open — TvSystemMenu itself, which claims
// above them). The shell still renders a placeholder when given no children so
// the foundation stands alone.
//
// v0.28 W278: TvShell also mounts `<TvSystemMenu/>` (gated on
// `tvMode.menuOpen`) above the outlet — the menu is a shell-level chrome
// concern (like the exit button), not owned by whatever `children` happens to
// be showing, so it survives a TvHome <-> embedded-screen swap underneath it.
//
// v0.37 W375 (issue #38): the section-label header no longer reserves its own
// row above the outlet — it's grouped with the exit/menu buttons into one
// absolutely-positioned top-right column (`.rgp-tv-shell__top-chrome`,
// tv-shell.css) layered over the outlet's content instead, so TV home's hero
// art fills the space the header used to reserve (more rail content visible
// with no other layout change needed).
//
// v0.37 W377 (user directive): the "Retro Game Player" label itself (and its
// scrim wash) is gone entirely — the top-chrome column now holds only the
// Menu/Exit buttons, which carry their own drop shadow (tv-shell.css) for
// legibility over the hero art instead of a dedicated background wash.

import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode } from "react";
import { HeroBackdrop } from "../library/HeroBackdrop";
import { DUR, EASE_OUT } from "../../lib/motion";
import { useTvMode } from "./TvModeContext";
// TvSystemMenu imports its own stylesheet (tv-system-menu.css); the ☰ Menu
// pointer button's styling lives in tv-shell.css alongside the exit button.
import { TvSystemMenu } from "./TvSystemMenu";
import "./tv-shell.css";

/** Shell-level crossfade for TV mode's entry/exit (tv-mode-design.md: crossfade
 * entry/exit via motion presets). Uses the existing DUR/EASE_OUT single motion
 * source (src/lib/motion.ts) — `--rgp-tv-transition-dur` in tv.css mirrors the
 * same `DUR.slow` value for any CSS-side consumer. */
const tvShellTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.slow, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DUR.slow, ease: EASE_OUT } },
} as const;

/** The placeholder TV-home region — rendered only when the shell is given no
 * children (the W260 foundation stood alone with this). `Root` passes the real
 * `<TvHome/>` in W261, so this is a dormant fallback, kept so TvShell is usable
 * on its own. */
function TvHomePlaceholder() {
  return (
    <div className="rgp-tv-home-placeholder">
      <p className="rgp-tv-home-placeholder__eyebrow">TV HOME</p>
      <p className="rgp-tv-home-placeholder__body">
        The leanback home (hero + Continue playing / Favorites / Recently added /
        per-console rails) renders here — this shell provides the full-bleed
        backdrop, safe-area frame, and 10-foot type scale it renders into.
      </p>
    </div>
  );
}

/**
 * The leanback shell: full-bleed dark backdrop, a 5%-overscan safe-area frame,
 * and an outlet region for TV-home content. `onExit` is called by the visible
 * (pointer) exit button; controller `back` exit is owned by the mounted home
 * content (see file header).
 */
export function TvShell({
  children,
  onExit,
}: {
  /** TV-home content (`<TvHome/>` from `Root`, or the placeholder when absent). */
  children?: ReactNode;
  onExit: () => void;
}) {
  const tvMode = useTvMode();
  return (
    <motion.div
      className="rgp-tv-shell"
      initial={tvShellTransition.initial}
      animate={tvShellTransition.animate}
      exit={tvShellTransition.exit}
      data-testid="tv-shell"
    >
      <HeroBackdrop game={null} variant="full-bleed" />
      <div className="rgp-tv-shell__frame">
        <main className="rgp-tv-shell__outlet">{children ?? <TvHomePlaceholder />}</main>
        {/* v0.37 W375 (issue #38): the pointer exit/menu buttons anchor to one
            top-right corner group — see `.rgp-tv-shell__top-chrome`'s comment
            (tv-shell.css) for why the top-RIGHT corner, specifically. v0.37
            W377 removed the section-label header that used to share this
            group; only the buttons remain. */}
        <div className="rgp-tv-shell__top-chrome">
          <div className="rgp-tv-shell__chrome-buttons">
            <button
              type="button"
              className="rgp-tv-shell__menu"
              onClick={tvMode.openMenu}
              aria-label="Open TV menu"
            >
              ☰ Menu
            </button>
            <button
              type="button"
              className="rgp-tv-shell__exit"
              onClick={onExit}
              aria-label="Exit TV mode"
            >
              ⤢ Exit TV mode (Cmd+T)
            </button>
          </div>
        </div>
      </div>
      <AnimatePresence>{tvMode.menuOpen && <TvSystemMenu />}</AnimatePresence>
    </motion.div>
  );
}
