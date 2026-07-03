// useMenuTrigger — raw-poll rising-edge detector for the TV system-menu open
// gesture (v0.28 W278, tv-mode-design.md §v0.28 → W278). Mirrors
// `useLongPress`'s shape (own small rAF loop reading `navigator.getGamepads()`
// directly + the same `resolveBindings`/`detectFamily` pure helpers) rather
// than routing through the shared `ControllerProvider` dispatch, so the
// trigger fires regardless of who currently holds the exclusive claim stack —
// exactly the property the TV-home exclusive handler and the takeover's
// swallow-all fallback claim would otherwise deny it (menu-open must work
// while the TV home owns the slot, and must NOT fire while a gameplay claim
// or a takeover surface owns it, gated below rather than by the claim stack).
//
// Unlike useLongPress this is RISING-EDGE, not hold-to-fire: the spec calls
// for an immediate open on a single Select/touchpad press, not a long hold.
// The button watched is `quit`'s resolved binding (Select, all families) PLUS
// PlayStation's aux touchpad binding (`defaultAuxBinding`, actions.ts) — both
// checked each tick so either physical button fires the trigger once per
// press, with a single shared rising-edge flag (either button counts as "the
// trigger is down" — pressing both at once never double-fires, and releasing
// either while the other is still held keeps the trigger armed-down until
// BOTH release, matching how a single physical button would behave).

import { useEffect, useRef } from "react";
import {
  type DeviceFamily,
  defaultAuxBinding,
  detectFamily,
  resolveBindings,
} from "./actions";

/** The minimal shape `isMenuTriggerPressed` needs from a `Gamepad` — just the
 * per-button pressed flag, so tests can pass a bare `{ buttons: { pressed }[] }`
 * fixture instead of a full W3C `GamepadButton` (which also requires `touched`/
 * `value`). A real `Gamepad.buttons` array satisfies this structurally. */
export interface MinimalGamepadButtons {
  buttons: ReadonlyArray<{ pressed: boolean }>;
}

/**
 * Whether the menu-open trigger reads as pressed on this poll tick: `quit`'s
 * resolved binding (Select, every family) OR — for PlayStation pads — the aux
 * touchpad button. Pure so the tick's "is the trigger down right now" question
 * is unit-testable without a rAF loop or a real `Gamepad` object.
 */
export function isMenuTriggerPressed(
  pad: MinimalGamepadButtons,
  family: DeviceFamily,
  overrides: ReadonlyArray<{ deviceFamily: string; action: string; button: string }> = [],
): boolean {
  const familyOverrides = overrides.filter((o) => o.deviceFamily === family);
  const bindings = resolveBindings(family, familyOverrides);
  const primaryIndex = bindings.quit;
  const auxIndex = defaultAuxBinding(family, "quit");

  const primaryPressed = pad.buttons[primaryIndex]?.pressed ?? false;
  const auxPressed = auxIndex !== null ? (pad.buttons[auxIndex]?.pressed ?? false) : false;
  return primaryPressed || auxPressed;
}

export interface MenuTriggerOptions {
  /** Fired once on the rising edge of Select (any family) or the PlayStation
   * touchpad click. */
  onTrigger: () => void;
  /** Persisted per-family binding overrides (same shape useGamepadPoll/
   * useLongPress take) — a rebound `quit` moves the primary trigger button
   * with it; the PlayStation aux touchpad binding is independent of the
   * rebind (see actions.ts §Aux bindings) and always applies. */
  overrides?: ReadonlyArray<{ deviceFamily: string; action: string; button: string }>;
  /** Disable polling — the caller gates this on "TV mode active, outside
   * gameplay, no takeover mounted, window focused" (tv-mode-design.md
   * §v0.28 → W278). */
  enabled?: boolean;
}

/**
 * Poll the first connected gamepad for the `quit`-bound button (Select, every
 * family) and, for PlayStation pads, the aux touchpad button too. Fires
 * `onTrigger` once on either button's rising edge; a release re-arms it for
 * the next press. Safe with no Gamepad API present (SSR/tests) — the effect
 * never starts a loop.
 */
export function useMenuTrigger(opts: MenuTriggerOptions): void {
  const { onTrigger, overrides = [], enabled = true } = opts;
  const onTriggerRef = useRef(onTrigger);
  const overridesRef = useRef(overrides);
  onTriggerRef.current = onTrigger;
  overridesRef.current = overrides;

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return;
    }

    let raf = 0;
    let wasPressed = false;

    const tick = () => {
      const pads = navigator.getGamepads();
      const pad = pads.find((p): p is Gamepad => p != null);
      if (pad) {
        const family = detectFamily(pad.id);
        const nowPressed = isMenuTriggerPressed(pad, family, overridesRef.current);
        if (nowPressed && !wasPressed) {
          onTriggerRef.current();
        }
        wasPressed = nowPressed;
      } else {
        wasPressed = false;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
