// Controller long-press detector (v0.26 W260, tv-mode-design.md §Controller).
//
// `useGamepadPoll` only ever emits RISING-EDGE semantic actions (one fire per
// press, design intent for confirm/back/nav) — it has no notion of "how long
// has this button been held", so it can't drive a hold-to-toggle affordance.
// Rather than bolt held-duration onto that shared, already-complex rAF loop,
// this is a small, independent poll: it reads the same raw Gamepad API
// (`navigator.getGamepads()`) and the same pure `actions.ts` binding-resolution
// helpers, but tracks ONE button's continuous-held duration and fires once
// when it crosses the long-press threshold (no repeat-fire while still held;
// releasing before the threshold cancels silently). Two independent polls
// reading the same read-only browser API is harmless (matches the existing
// `resolveBindings`/`detectFamily` reuse pattern) and keeps this feature's
// surface area additive rather than threading a new concern through the
// shared dispatch hook every other screen depends on.
//
// The pure duration→fired classification (`longPressElapsed`) is unit-tested
// without hardware, mirroring useGamepadPoll's own pure/impure split.

import { useEffect, useRef } from "react";
import {
  type DeviceFamily,
  type SemanticAction,
  detectFamily,
  resolveBindings,
} from "./actions";

/** Long-press hold duration (ms) — mirrors `--rgp-tv-long-press-ms` in
 * theme/tv.css (the CSS token the same interval is expressed as for anything
 * that needs to *show* the threshold, e.g. a future hold-progress ring). CSS
 * custom properties aren't readable from a rAF loop, so the number is the
 * single JS source and the token is the single CSS source — keep both in
 * sync if this changes, the way DUR/EASE mirror motion.ts <-> motion.css. */
export const LONG_PRESS_MS = 600;

/**
 * Pure classifier: given how long a button has been continuously held (ms),
 * has it crossed the long-press threshold? Exists as its own function (rather
 * than inlining `>=`) so the rAF loop's "fire once, not on every frame past
 * threshold" edge case has one well-named, independently testable unit.
 */
export function longPressElapsed(heldMs: number, thresholdMs: number = LONG_PRESS_MS): boolean {
  return heldMs >= thresholdMs;
}

export interface LongPressOptions {
  /** The semantic action to watch (resolved to a button index per the active
   * device family's bindings, same as useGamepadPoll). */
  action: SemanticAction;
  /** Fired exactly once when the button crosses the long-press threshold
   * while held; the user must release and re-press to fire again. */
  onLongPress: () => void;
  /** Persisted per-family binding overrides (same shape useGamepadPoll takes). */
  overrides?: ReadonlyArray<{ deviceFamily: string; action: string; button: string }>;
  /** Disable polling — e.g. while a text-entry surface or the exclusive
   * gameplay input owner holds the controller. */
  enabled?: boolean;
}

/**
 * Poll the first connected gamepad for `action`'s bound button and fire
 * `onLongPress` once it has been held continuously for `LONG_PRESS_MS`. A
 * release before the threshold cancels with no callback. Safe with no
 * Gamepad API present (SSR/tests) — the effect simply never starts a loop.
 */
export function useLongPress(opts: LongPressOptions): void {
  const { action, onLongPress, overrides = [], enabled = true } = opts;
  const onLongPressRef = useRef(onLongPress);
  const overridesRef = useRef(overrides);
  onLongPressRef.current = onLongPress;
  overridesRef.current = overrides;

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return;
    }

    let raf = 0;
    let pressStartedAt: number | null = null;
    let firedForThisPress = false;

    const overridesFor = (family: DeviceFamily) =>
      overridesRef.current.filter((o) => o.deviceFamily === family);

    const tick = (now: number) => {
      const pads = navigator.getGamepads();
      const pad = pads.find((p): p is Gamepad => p != null);
      if (pad) {
        const family = detectFamily(pad.id);
        const bindings = resolveBindings(family, overridesFor(family));
        const buttonIndex = bindings[action];
        const pressed = pad.buttons[buttonIndex]?.pressed ?? false;

        if (pressed) {
          if (pressStartedAt === null) {
            pressStartedAt = now;
            firedForThisPress = false;
          } else if (!firedForThisPress && longPressElapsed(now - pressStartedAt)) {
            firedForThisPress = true;
            onLongPressRef.current();
          }
        } else {
          pressStartedAt = null;
          firedForThisPress = false;
        }
      } else {
        pressStartedAt = null;
        firedForThisPress = false;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [action, enabled]);
}
