// Gamepad polling spike (W14, controller-input-design.md §1). INTEGRATION CHOICE:
// the browser **Gamepad API** (`navigator.getGamepads()`) over a native Tauri
// plugin. The Tauri 2 WKWebView exposes the standard Gamepad API, so this needs
// zero native registration, zero new Rust crates, and zero added capabilities —
// keeping shared-file edits minimal. See the design doc for the trade-off.
//
// This hook is the ONLY impure input surface: it runs a requestAnimationFrame
// loop, diffs pressed buttons + stick axes per frame, and invokes `onAction`
// with each rising-edge SemanticAction. All mapping logic is delegated to the
// pure `actions.ts` module, which is unit-tested without hardware.

import { useEffect, useRef } from "react";
import {
  SEMANTIC_ACTIONS,
  type BindingMap,
  type DeviceFamily,
  type GamepadMapping,
  type SemanticAction,
  classifyMapping,
  detectFamily,
  resolveBindings,
  risingActions,
  stickToNav,
} from "./actions";

/** Left-stick axis indices in the W3C standard mapping. */
const AXIS_LEFT_X = 0;
const AXIS_LEFT_Y = 1;
/** Repeat cadence (ms) while a stick is held past the deadzone — avoids one move per frame. */
const STICK_REPEAT_MS = 180;

// ── Digital D-pad hold-to-repeat (W262, tv-mode-design.md §Acceptance bullet 5) ──
//
// risingActions() below only ever fires a nav action on the press's rising
// edge — correct for confirm/back/menu/quit (one fire per press), but a D-pad
// held down should auto-repeat the move like the analog stick already does
// (STICK_REPEAT_MS above) and like every leanback/console UI: a brief initial
// delay so a single tap never double-fires, then a steady repeat cadence.
// Keyboard arrows get the same feel for free via the browser's native OS key-
// repeat (a `keydown` handler firing on the DOM, unrelated to this poll) — see
// railNav's consumer, which reacts to one nav action per call either way.

/** Delay (ms) after a D-pad direction is first pressed before it starts
 * auto-repeating — long enough that a quick single tap can never double-fire. */
export const NAV_REPEAT_DELAY_MS = 400;
/** Repeat cadence (ms) once a held D-pad direction is auto-repeating. Faster
 * than the initial delay (standard "accelerate into it" leanback feel) but
 * slow enough that a rail traversal stays readable at distance. */
export const NAV_REPEAT_INTERVAL_MS = 150;

/** The four semantic actions eligible for D-pad hold-to-repeat. Confirm/back/
 * menu/quit are deliberately excluded — those must stay single-fire-per-press. */
const REPEATABLE_NAV_ACTIONS: ReadonlySet<SemanticAction> = new Set([
  "nav_up",
  "nav_down",
  "nav_left",
  "nav_right",
]);

/**
 * Pure scheduler: given how long a repeatable action has been continuously
 * held (ms) and how long ago it last fired (ms, `null` if it has only fired
 * once on the initial press), should it fire again THIS frame? Mirrors
 * `longPressElapsed`'s pure/impure split (useLongPress.ts) so the "first
 * repeat needs the longer initial delay, subsequent repeats use the shorter
 * interval" edge case is independently unit-testable without a rAF loop.
 */
export function navRepeatDue(
  heldMs: number,
  msSinceLastFire: number | null,
  delayMs: number = NAV_REPEAT_DELAY_MS,
  intervalMs: number = NAV_REPEAT_INTERVAL_MS,
): boolean {
  if (msSinceLastFire === null) return heldMs >= delayMs;
  return msSinceLastFire >= intervalMs;
}

// ── Non-standard mapping degradation notice (W268) ──────────────────────────
//
// Mirrors the session-scoped "show once, always log" funnel used by
// src/features/play/degradation.ts, scoped to the controller-input layer: a
// pad whose `mapping` isn't `"standard"` still gets the best-effort
// STANDARD_BUTTON fallback (most such pads are physically standard-shaped),
// but the user should see ONE visible hint per session per device family
// rather than silently-possibly-wrong input.

/** User-facing copy for the non-standard-mapping degradation notice. */
export interface MappingDegradationNotice {
  message: string;
  hint: string;
}

const MAPPING_DEGRADATION_NOTICE: MappingDegradationNotice = {
  message:
    "This controller didn't report a standard button layout — using a best-effort mapping.",
  hint: "If buttons feel wrong, remap them in Settings → Controllers.",
};

/** Session-scoped memory of which device families already showed the notice. */
const shownMappingDegradations = new Set<DeviceFamily>();

/** Look up the copy for the non-standard-mapping degradation notice. */
export function describeMappingDegradation(): MappingDegradationNotice {
  return MAPPING_DEGRADATION_NOTICE;
}

/**
 * Records a non-standard-mapping degradation for a device family: logs it
 * (the single funnel) and reports whether the notice should be shown to the
 * user (first occurrence this session, per family, only).
 */
export function recordMappingDegradation(
  family: DeviceFamily,
  mapping: GamepadMapping,
): boolean {
  console.warn(`[rgp-controller] non-standard mapping for ${family}: "${mapping}"`);
  if (shownMappingDegradations.has(family)) return false;
  shownMappingDegradations.add(family);
  return true;
}

/** Test hook: forget shown mapping-degradation notices. */
export function resetMappingDegradationsForTest(): void {
  shownMappingDegradations.clear();
}

export interface GamepadPollOptions {
  /** Fired once per rising-edge semantic action. */
  onAction: (action: SemanticAction) => void;
  /** Persisted overrides per device family (folded over compiled-in defaults). */
  overrides?: ReadonlyArray<{ deviceFamily: string; action: string; button: string }>;
  /** Notified when the active controller family changes (drives HintBar glyphs). */
  onFamilyChange?: (family: DeviceFamily) => void;
  /**
   * Notified the first time (per session, per family) a connected pad reports a
   * non-"standard" mapping — surfaces the degradation hint (e.g. via HintBar or
   * a dismissible notice) so the user knows to check their binding in Settings.
   */
  onMappingDegraded?: (notice: MappingDegradationNotice) => void;
  /** Disable polling (e.g. while a text-entry overlay owns input). */
  enabled?: boolean;
}

/**
 * Poll the first connected gamepad and emit semantic actions. Returns nothing;
 * it wires a rAF loop for the component's lifetime. Safe in non-gamepad
 * environments — `getGamepads` simply yields no pads and the loop idles.
 */
export function useGamepadPoll(opts: GamepadPollOptions): void {
  const { onAction, overrides = [], onFamilyChange, onMappingDegraded, enabled = true } = opts;
  // Keep mutable callback/over­ride refs so the rAF loop never restarts mid-press.
  const onActionRef = useRef(onAction);
  const onFamilyRef = useRef(onFamilyChange);
  const onMappingDegradedRef = useRef(onMappingDegraded);
  const overridesRef = useRef(overrides);
  onActionRef.current = onAction;
  onFamilyRef.current = onFamilyChange;
  onMappingDegradedRef.current = onMappingDegraded;
  overridesRef.current = overrides;

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return; // No Gamepad API (e.g. SSR / test env) — nothing to poll.
    }

    let raf = 0;
    let prevPressed = new Set<number>();
    let lastFamily: DeviceFamily | null = null;
    let lastStickFire = 0;
    // Hold-to-repeat state for the currently-held repeatable nav button (at
    // most one D-pad direction can be physically held at a time in practice;
    // tracking a single button index keeps this a plain scalar, not a map).
    let heldNavButton: number | null = null;
    let heldNavSince = 0;
    let lastNavRepeatFire: number | null = null;

    const overridesFor = (family: DeviceFamily) =>
      overridesRef.current.filter((o) => o.deviceFamily === family);

    const tick = (now: number) => {
      const pads = navigator.getGamepads();
      const pad = pads.find((p): p is Gamepad => p != null);
      if (pad) {
        const family = detectFamily(pad.id);
        if (family !== lastFamily) {
          lastFamily = family;
          onFamilyRef.current?.(family);
          // Best-effort fallback still applies STANDARD_BUTTON indices below —
          // this only surfaces the visible hint once per family per session so
          // a non-standard pad never produces silently-dead/mis-mapped input.
          const { degraded, mapping } = classifyMapping(pad.mapping);
          if (degraded && recordMappingDegradation(family, mapping)) {
            onMappingDegradedRef.current?.(describeMappingDegradation());
          }
        }
        const bindings: BindingMap = resolveBindings(family, overridesFor(family));

        // Digital buttons: rising-edge detection.
        const nowPressed = new Set<number>();
        pad.buttons.forEach((b, i) => {
          if (b.pressed) nowPressed.add(i);
        });
        for (const action of risingActions(bindings, prevPressed, nowPressed)) {
          onActionRef.current(action);
        }
        prevPressed = nowPressed;

        // D-pad hold-to-repeat (design: "holding a nav direction repeats
        // movement at a tokenized interval after a tokenized delay"). Only the
        // four repeatable nav actions auto-repeat; confirm/back/menu/quit stay
        // single-fire via risingActions above. Re-resolves which button (if
        // any) is bound to a repeatable action and currently held each frame,
        // so a rebind takes effect immediately and releasing/switching buttons
        // resets the hold cleanly.
        let currentHeldButton: number | null = null;
        for (const action of SEMANTIC_ACTIONS) {
          if (!REPEATABLE_NAV_ACTIONS.has(action)) continue;
          const idx = bindings[action];
          if (nowPressed.has(idx)) {
            currentHeldButton = idx;
            break;
          }
        }
        if (currentHeldButton === null) {
          heldNavButton = null;
          lastNavRepeatFire = null;
        } else if (currentHeldButton !== heldNavButton) {
          // A new hold started (or switched buttons) — the initial rising-edge
          // fire above already moved focus once; the repeat clock starts now.
          heldNavButton = currentHeldButton;
          heldNavSince = now;
          lastNavRepeatFire = null;
        } else {
          const heldMs = now - heldNavSince;
          const sinceLastFire = lastNavRepeatFire === null ? null : now - lastNavRepeatFire;
          if (navRepeatDue(heldMs, sinceLastFire)) {
            lastNavRepeatFire = now;
            const repeatedAction = SEMANTIC_ACTIONS.find(
              (a) => REPEATABLE_NAV_ACTIONS.has(a) && bindings[a] === currentHeldButton,
            );
            if (repeatedAction) onActionRef.current(repeatedAction);
          }
        }

        // Analog stick → nav, rate-limited so a held stick repeats, not floods.
        const nav = stickToNav(pad.axes[AXIS_LEFT_X] ?? 0, pad.axes[AXIS_LEFT_Y] ?? 0);
        if (nav && now - lastStickFire >= STICK_REPEAT_MS) {
          lastStickFire = now;
          onActionRef.current(nav);
        } else if (!nav) {
          lastStickFire = 0; // reset so the next push fires immediately
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
