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
