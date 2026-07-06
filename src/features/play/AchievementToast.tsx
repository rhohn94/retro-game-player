// AchievementToast — the non-intrusive "Achievement unlocked" banner shown
// over the running game (v0.37 W372, retroachievements-design.md §Unlock UX
// + persistence). Purely presentational: `useAchievementUnlocks` owns the
// queue/auto-dismiss timing; this component only renders whatever toast (or
// none) it is handed. Deliberately NOT part of PlayerOverlay (the pause
// menu) — a toast must be visible WHILE the game keeps running, and must
// never capture input (no buttons, no focusable elements, `aria-live` only).

import { AnimatePresence, motion } from "framer-motion";
import { DUR } from "../../lib/motion";
import type { UnlockToast } from "../../ipc/retroachievements";

export interface AchievementToastProps {
  /** The toast to show, or `null` to render nothing. */
  toast: UnlockToast | null;
}

/** A single, auto-dismissing achievement-unlock banner. Renders nothing
 * (not just hidden) when `toast` is `null`, so it never reserves layout
 * space or intercepts pointer events while idle. */
export function AchievementToast({ toast }: AchievementToastProps) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.achievementId}
          className="rgp-achievement-toast"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: DUR.fast }}
        >
          <span className="rgp-achievement-toast__icon" aria-hidden="true">
            🏆
          </span>
          <div className="rgp-achievement-toast__body">
            <p className="rgp-achievement-toast__title">{toast.title}</p>
            {toast.description && (
              <p className="rgp-achievement-toast__desc">{toast.description}</p>
            )}
          </div>
          {toast.points > 0 && (
            <span className="rgp-achievement-toast__points">{toast.points} pts</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
