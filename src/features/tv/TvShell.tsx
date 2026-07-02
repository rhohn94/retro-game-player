// TvShell — the full-viewport leanback chrome TV mode renders instead of the
// desktop sidebar+content tree (v0.26 W260, tv-mode-design.md §Design "Shelves"
// scaffolding + §Design "Mode model"). This item lays the FOUNDATION every
// later TV pass builds on:
//   - W261 (TV home) replaces `<TvHomePlaceholder/>` with the real hero+rails.
//   - W262 (focus/snap) extends the `--rgp-tv-*` tokens this file establishes.
//   - W265 (transitions) extends the crossfade this file wires for entry/exit.
//
// Composable by design: `TvShell` owns the chrome (backdrop, safe-area inset,
// section-label header, exit affordance) and renders `children` into a marked
// outlet region — later work items pass `<TvHome/>` instead of the
// placeholder without touching this file's structure.

import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { HeroBackdrop } from "../library/HeroBackdrop";
import { useController } from "../controller";
import { DUR, EASE_OUT } from "../../lib/motion";
import "./tv-shell.css";

/** Shell-level crossfade for TV mode's entry/exit (tv-mode-design.md: "Beautiful
 * matters: … crossfade entry/exit via motion presets"). Uses the existing
 * DUR/EASE_OUT single motion source (src/lib/motion.ts) rather than a
 * TV-specific literal — `--rgp-tv-transition-dur` in tv.css mirrors the same
 * `DUR.slow` value for any CSS-side consumer, the same DUR<->motion.css
 * mirroring pattern the rest of the app already follows. */
const tvShellTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.slow, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DUR.slow, ease: EASE_OUT } },
} as const;

/** How long the "press back again to exit" confirm affordance stays visible
 * before resetting, so a stray/accidental back press at TV root doesn't leave
 * the app one press away from silently exiting minutes later. */
const EXIT_CONFIRM_TIMEOUT_MS = 3000;

/** The placeholder TV-home region — W261 replaces this with `<TvHome/>` (hero
 * + Continue playing / Favorites / Recently added / per-console rails). Kept
 * as its own component so the swap is a one-line change in `TvShell`. */
function TvHomePlaceholder() {
  return (
    <div className="rgp-tv-home-placeholder">
      <p className="rgp-tv-home-placeholder__eyebrow">TV HOME</p>
      <p className="rgp-tv-home-placeholder__body">
        The leanback home (hero + Continue playing / Favorites / Recently
        added / per-console rails) lands in the next pass — this shell already
        gives it a full-bleed backdrop, safe-area frame, and 10-foot type scale
        to render into.
      </p>
    </div>
  );
}

/**
 * The leanback shell: full-bleed dark backdrop, a 5%-overscan safe-area frame,
 * a chunky retro-accent section label, and an outlet region for TV-home
 * content. `onExit` is called when the user confirms exiting from TV root
 * (the `back` controller action, or the visible exit button).
 */
export function TvShell({
  children,
  onExit,
}: {
  /** TV-home content (or `TvHomePlaceholder` until W261 lands). */
  children?: ReactNode;
  onExit: () => void;
}) {
  const [confirmingExit, setConfirmingExit] = useState(false);

  // `back` at TV root exits with a brief confirm affordance (tv-mode-design.md
  // §Controller: "back at TV home exits TV mode (with confirm)") rather than
  // exiting on the first press — TV mode has no "back stack" to unwind first
  // (there's exactly one TV surface today; W261's home/detail split will let a
  // detail screen's own `back` handler take priority via the existing
  // per-screen setActionHandlers seam, unaffected by this).
  const { setActionHandlers } = useController();
  useEffect(() => {
    setActionHandlers({
      back: () => {
        setConfirmingExit((wasConfirming) => {
          if (wasConfirming) {
            onExit();
            return false;
          }
          return true;
        });
      },
    });
    return () => setActionHandlers({});
  }, [setActionHandlers, onExit]);

  useEffect(() => {
    if (!confirmingExit) return;
    const timer = window.setTimeout(() => setConfirmingExit(false), EXIT_CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [confirmingExit]);

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
        {confirmingExit && (
          <div className="rgp-tv-shell__confirm" role="status">
            Press Back again to exit TV mode
          </div>
        )}
      </div>
    </motion.div>
  );
}
