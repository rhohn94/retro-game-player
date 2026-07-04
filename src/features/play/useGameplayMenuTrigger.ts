// useGameplayMenuTrigger — the gameplay-only overlay-open gesture (v0.28
// W279, controller-input-design.md §Gameplay menu trigger). Replaces the old
// "bare Start press opens the overlay" contract (routeScopedAction's removed
// bare-`menu` branch): every game needs Start for its own play (pause/select/
// etc.), so a single Start press must reach the core ONLY — see this file's
// sibling nativeInput.ts, which keeps mapping Start straight to the NES
// START bit on every tick regardless of overlay state, unchanged by this work.
//
// Two additive ways to summon the overlay while a player holds the gameplay
// claim (the user's "or" — both ship, not a choice made for them):
//   1. Chord: Start + Select held together in the same poll tick — fires
//      once, immediately, on the rising edge of "both down".
//   2. Hold: Start held alone (Select NOT down — a chord attempt that
//      hasn't completed must not also count toward the hold) for
//      `MENU_HOLD_MS` (5000 ms) — its OWN named constant, deliberately not
//      the unrelated `LONG_PRESS_MS` (600 ms, TV-mode toggle in
//      controller/useLongPress.ts). Releasing before the threshold cancels
//      silently — no overlay, no partial-open, and the hook re-arms for the
//      next press.
//
// Mirrors useLongPress/useMenuTrigger's shape: its own small rAF loop reading
// `navigator.getGamepads()` directly plus the same pure `resolveBindings`/
// `detectFamily` helpers, independent of the semantic-action dispatch (so it
// works regardless of the exclusive-claim stack — exactly like those two
// hooks). Unlike useLongPress, this ALSO reports live held-duration via
// `onProgress` (0..1 against the 5 s threshold) so the caller can drive a
// building hold indicator; useLongPress itself is untouched (its existing
// single-fire callers/tests keep working unmodified).

import { useEffect, useRef } from "react";
import { type DeviceFamily, detectFamily, resolveBindings } from "../controller/actions";

/** Hold-to-open-menu duration (ms) — mirrors `--rgp-tv-menu-hold-ms` in
 * theme/tv.css (dual-source pattern: a CSS custom property can't be read by a
 * rAF loop, so the number is the single JS source and the token is the single
 * CSS source, the same way LONG_PRESS_MS mirrors `--rgp-tv-long-press-ms`).
 * Deliberately a SEPARATE constant from the unrelated 600 ms `LONG_PRESS_MS`
 * (controller/useLongPress.ts, the TV-mode toggle) even though the mechanism
 * is similar — conflating the two was explicitly called out as a mistake to
 * avoid (release-planning-v0.28.md §W279). */
export const MENU_HOLD_MS = 5000;

/** The minimal shape this hook needs from a `Gamepad` — just the per-button
 * pressed flag, matching useMenuTrigger's MinimalGamepadButtons so tests can
 * pass a bare fixture instead of a full W3C GamepadButton. */
export interface MinimalGamepadButtons {
  buttons: ReadonlyArray<{ pressed: boolean }>;
}

/** One poll tick's classification of the two watched buttons — pure so the
 * "what is the pad doing right now" question is unit-testable without a rAF
 * loop or a real Gamepad object. */
export interface MenuTriggerButtonState {
  startPressed: boolean;
  selectPressed: boolean;
}

/**
 * Read whether Start and Select (this family's resolved bindings, persisted
 * overrides applied) are pressed on this poll tick. Pure and family-scoped,
 * mirroring `isMenuTriggerPressed`.
 */
export function readMenuTriggerButtons(
  pad: MinimalGamepadButtons,
  family: DeviceFamily,
  overrides: ReadonlyArray<{ deviceFamily: string; action: string; button: string }> = [],
): MenuTriggerButtonState {
  const familyOverrides = overrides.filter((o) => o.deviceFamily === family);
  const bindings = resolveBindings(family, familyOverrides);
  return {
    startPressed: pad.buttons[bindings.menu]?.pressed ?? false,
    selectPressed: pad.buttons[bindings.quit]?.pressed ?? false,
  };
}

/** Whether the Start+Select chord reads as down this tick — both buttons
 * pressed together. Its own named predicate (rather than inlining `&&`) so
 * the rAF loop's rising-edge logic reads as intent, matching
 * `longPressElapsed`'s standalone-function treatment in useLongPress.ts. */
export function chordPressed(state: MenuTriggerButtonState): boolean {
  return state.startPressed && state.selectPressed;
}

/**
 * Whether Start is being held ALONE toward the hold-open threshold this tick
 * — Start down, Select NOT down. A chord attempt in progress (both buttons
 * down but the chord hasn't fired yet — impossible in practice since the
 * chord fires on the same tick both go down, but kept explicit for clarity
 * and testability) never also accumulates hold progress, so releasing just
 * the chord's Select half a moment early can't accidentally fast-track a
 * hold-open on the same press.
 */
export function soloHoldCandidate(state: MenuTriggerButtonState): boolean {
  return state.startPressed && !state.selectPressed;
}

/**
 * Pure classifier: given how long Start has been continuously held alone
 * (ms), has it crossed the hold-to-open threshold? Mirrors
 * `longPressElapsed`'s "own well-named function, not an inlined `>=`" shape.
 */
export function menuHoldElapsed(heldMs: number, thresholdMs: number = MENU_HOLD_MS): boolean {
  return heldMs >= thresholdMs;
}

/**
 * Progress toward the hold-open threshold, clamped to [0, 1] — 0 while not
 * holding (or just starting), 1 once the threshold has elapsed. The hold
 * indicator's building affordance reads this directly; a static/stepped
 * rendering under reduced motion is the caller's concern (this is plain
 * arithmetic, no timing/animation policy lives here).
 */
export function menuHoldProgress(heldMs: number, thresholdMs: number = MENU_HOLD_MS): number {
  if (thresholdMs <= 0) return heldMs > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, heldMs / thresholdMs));
}

export interface GameplayMenuTriggerOptions {
  /** Fired once — either on the Start+Select chord's rising edge, or the
   * instant a solo Start hold crosses `MENU_HOLD_MS`. */
  onOpen: () => void;
  /** Live hold progress toward the threshold, reported every tick Start is
   * held alone: 0 the instant the hold starts, 1 at/after the threshold
   * (immediately followed by `onOpen`), and back to 0 the tick the hold ends
   * (release, chord supersedes it, or pad disconnects) — drives the building
   * indicator. Omit if the caller doesn't render one. */
  onProgress?: (progress: number) => void;
  /** Persisted per-family binding overrides (same shape useLongPress/
   * useMenuTrigger take) — a rebound `menu`/`quit` moves the chord/hold with
   * it. */
  overrides?: ReadonlyArray<{ deviceFamily: string; action: string; button: string }>;
  /** Disable polling — the caller gates this on "this player currently owns
   * the gameplay exclusive claim" (useExclusiveControllerScope). */
  enabled?: boolean;
}

/**
 * Poll the first connected gamepad for the Start+Select chord and the
 * solo-Start hold, independent of the semantic-action dispatch (same raw-poll
 * pattern as useLongPress/useMenuTrigger, so it fires regardless of the
 * exclusive-claim stack's current owner — the caller is responsible for only
 * enabling it while gameplay legitimately owns the pad). Safe with no Gamepad
 * API present (SSR/tests) — the effect never starts a loop.
 */
export function useGameplayMenuTrigger(opts: GameplayMenuTriggerOptions): void {
  const { onOpen, onProgress, overrides = [], enabled = true } = opts;
  const onOpenRef = useRef(onOpen);
  const onProgressRef = useRef(onProgress);
  const overridesRef = useRef(overrides);
  onOpenRef.current = onOpen;
  onProgressRef.current = onProgress;
  overridesRef.current = overrides;

  useEffect(() => {
    if (!enabled) {
      onProgressRef.current?.(0); // disabling mid-hold cancels the indicator, not just the timer
      return;
    }
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return;
    }

    let raf = 0;
    let holdStartedAt: number | null = null;
    let firedForThisHold = false;
    let wasChordDown = false;
    let lastReportedProgress = -1;

    const reportProgress = (progress: number) => {
      if (progress === lastReportedProgress) return;
      lastReportedProgress = progress;
      onProgressRef.current?.(progress);
    };

    const resetHold = () => {
      holdStartedAt = null;
      firedForThisHold = false;
      reportProgress(0);
    };

    const tick = (now: number) => {
      const pads = navigator.getGamepads();
      const pad = pads.find((p): p is Gamepad => p != null);
      if (!pad) {
        wasChordDown = false;
        resetHold();
        raf = requestAnimationFrame(tick);
        return;
      }

      const family = detectFamily(pad.id);
      const state = readMenuTriggerButtons(pad, family, overridesRef.current);

      // Chord: rising edge only, fires once, takes priority over — and
      // cancels — any in-progress solo hold (Select joining mid-hold means
      // the user is chording, not holding; the hold must not also fire).
      const chordDown = chordPressed(state);
      if (chordDown && !wasChordDown) {
        resetHold();
        onOpenRef.current();
      }
      wasChordDown = chordDown;

      // Solo hold: only accumulates while Start is down and Select is not.
      if (!chordDown && soloHoldCandidate(state)) {
        if (holdStartedAt === null) {
          holdStartedAt = now;
          firedForThisHold = false;
        }
        const heldMs = now - holdStartedAt;
        reportProgress(menuHoldProgress(heldMs));
        if (!firedForThisHold && menuHoldElapsed(heldMs)) {
          firedForThisHold = true;
          onOpenRef.current();
        }
      } else if (!chordDown) {
        resetHold();
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
