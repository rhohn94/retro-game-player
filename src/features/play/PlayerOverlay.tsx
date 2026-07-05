// PlayerOverlay — the shared in-game overlay panel (v0.23 W232). Extracted
// from InPagePlayer so both play paths (EmulatorJS iframe and the native
// canvas player) render the identical Resume / Save state / Load state /
// … / Exit menu with the same motion and controller-selection affordances.
// Purely presentational: items, selection, and open/close live in the player.

import { AnimatePresence, motion } from "framer-motion";
import { DUR, dialogPop } from "../../lib/motion";
import { PlayerCountIndicator } from "./PlayerCountIndicator";

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
  /** Volume slider row (W243) — mouse-driven; keyboard/controller users get
   * the Mute item the players add to `items`. */
  volume?: { value: number; onChange: (volume: number) => void };
  /** How many gamepads are currently assigned a native-input port (v0.35
   * W351) — `undefined` (the in-page/EmulatorJS path, which doesn't track
   * per-port assignment) omits the indicator entirely rather than showing a
   * misleading "P1". */
  connectedPadCount?: number;
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
  volume,
  connectedPadCount,
}: PlayerOverlayProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="rgp-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.fast }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onScrimClick();
          }}
        >
          <motion.div
            className="rgp-overlay__panel"
            role="dialog"
            aria-modal="true"
            aria-label={`${gameName} menu`}
            {...dialogPop}
          >
            <div className="rgp-overlay__title-row">
              <p className="rgp-overlay__title">{gameName}</p>
              {connectedPadCount != null && <PlayerCountIndicator connectedPadCount={connectedPadCount} />}
            </div>
            <div className="rgp-overlay__actions" role="menu">
              {items.map((it, i) => (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  className={
                    i === selection
                      ? "rgp-overlay__btn rgp-overlay__btn--active"
                      : "rgp-overlay__btn"
                  }
                  onMouseEnter={() => setSelection(i)}
                  onFocus={() => setSelection(i)}
                  onClick={() => {
                    if (!it.disabled) it.run();
                  }}
                >
                  {it.label}
                </button>
              ))}
            </div>
            {volume && (
              <label className="rgp-overlay__volume">
                <span>🔊 Volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume.value}
                  aria-label="Volume"
                  onChange={(e) => volume.onChange(Number(e.target.value))}
                />
                <span className="rgp-overlay__volume-pct">
                  {Math.round(volume.value * 100)}%
                </span>
              </label>
            )}
            {status && <p className="rgp-overlay__status">{status}</p>}
            {hint && <p className="rgp-overlay__hint">{hint}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
