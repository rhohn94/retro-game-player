// PlayerOverlay — the shared in-game overlay panel (v0.23 W232). Extracted
// from InPagePlayer so both play paths (EmulatorJS iframe and the native
// canvas player) render the identical Resume / Save state / Load state /
// … / Exit menu with the same motion and controller-selection affordances.
// Purely presentational: items, selection, and open/close live in the player.

import { AnimatePresence, motion } from "framer-motion";
import { DUR, dialogPop } from "../../lib/motion";

/** One overlay menu entry. `disabled` rows render but don't activate. */
export interface OverlayItem {
  key: string;
  label: string;
  disabled?: boolean;
  run: () => void;
}

export interface PlayerOverlayProps {
  gameName: string;
  open: boolean;
  items: OverlayItem[];
  selection: number;
  setSelection: (index: number) => void;
  /** Clicking the scrim (outside the panel) — typically closes the overlay. */
  onScrimClick: () => void;
  /** A transient status line (e.g. "Saved to slot 2"), shown under the menu. */
  status?: string | null;
  hint?: string;
}

/** The overlay scrim + panel; renders nothing while closed. */
export function PlayerOverlay({
  gameName,
  open,
  items,
  selection,
  setSelection,
  onScrimClick,
  status,
  hint,
}: PlayerOverlayProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="harmony-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.fast }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onScrimClick();
          }}
        >
          <motion.div className="harmony-overlay__panel" {...dialogPop}>
            <p className="harmony-overlay__title">{gameName}</p>
            <div className="harmony-overlay__actions">
              {items.map((it, i) => (
                <button
                  key={it.key}
                  type="button"
                  disabled={it.disabled}
                  className={
                    i === selection
                      ? "harmony-overlay__btn harmony-overlay__btn--active"
                      : "harmony-overlay__btn"
                  }
                  onMouseEnter={() => setSelection(i)}
                  onClick={() => {
                    if (!it.disabled) it.run();
                  }}
                >
                  {it.label}
                </button>
              ))}
            </div>
            {status && <p className="harmony-overlay__status">{status}</p>}
            {hint && <p className="harmony-overlay__hint">{hint}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
