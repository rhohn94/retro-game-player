// TvShell — the full-viewport leanback chrome TV mode renders instead of the
// desktop sidebar+content tree (v0.26 W260 foundation; W261 fills the outlet
// with the real TV home). TvShell owns the CHROME (full-bleed backdrop,
// 5%-overscan safe-area frame, section-label header, pointer exit affordance)
// and renders its `children` — the real `<TvHome/>` from `Root` — into a marked
// outlet region.
//
// Controller `back` + the "press Back again to exit" confirm gesture are owned
// by the mounted home content (TvHome installs the controller's EXCLUSIVE
// handler and drives its own two-press exit-confirm via useTvExitConfirm), NOT
// by this shell: an exclusive handler takes priority over any screen-level
// `setActionHandlers`, so a `back` handler here would be dead while a home is
// mounted. TvShell therefore keeps only the POINTER exit affordance (the visible
// button); the controller-driven confirm lives with whoever owns the exclusive
// handler. The shell still renders a placeholder when given no children so the
// foundation stands alone.

import { motion } from "framer-motion";
import { type ReactNode } from "react";
import { HeroBackdrop } from "../library/HeroBackdrop";
import { DUR, EASE_OUT } from "../../lib/motion";
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
 * a chunky retro-accent section label, and an outlet region for TV-home
 * content. `onExit` is called by the visible (pointer) exit button; controller
 * `back` exit is owned by the mounted home content (see file header).
 */
export function TvShell({
  children,
  onExit,
}: {
  /** TV-home content (`<TvHome/>` from `Root`, or the placeholder when absent). */
  children?: ReactNode;
  onExit: () => void;
}) {
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
        <header className="rgp-tv-shell__header">
          <span className="rgp-tv-shell__label">Retro Game Player</span>
        </header>
        <main className="rgp-tv-shell__outlet">{children ?? <TvHomePlaceholder />}</main>
        <button
          type="button"
          className="rgp-tv-shell__exit"
          onClick={onExit}
          aria-label="Exit TV mode"
        >
          ⤢ Exit TV mode (Cmd+T)
        </button>
      </div>
    </motion.div>
  );
}
