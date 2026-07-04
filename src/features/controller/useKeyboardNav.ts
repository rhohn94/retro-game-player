// useKeyboardNav — the global keyboard-to-semantic-action bridge (W283,
// controller-input-design.md §Keyboard as an input method). Mounted ONCE at
// the app root (App.tsx, inside ControllerProvider) so every surface —
// desktop routes, TV mode's home/system-menu/embedded screens, and the
// gameplay overlay — is reachable from a keyboard with no per-screen wiring,
// the same "one shared dispatch, every screen just works" property
// `useGamepadPoll` already gives every gamepad user.
//
// Deliberately mirrors the existing raw-poll hooks' pure/impure split
// (useLongPress.ts, useMenuTrigger.ts): `keyToSemanticAction`/
// `isNativeControlTarget`/`isNativeActivationTarget`/`isControlGuardExempt`
// (keyboardMap.ts) are the pure, unit-tested classification; this hook is
// only the thin DOM listener that reads the target off the DOM and forwards
// to `dispatchAction`.
//
// This is ADDITIVE, not a replacement: it feeds the SAME
// `ControllerContextValue.dispatchAction` (the exact function
// `useGamepadPoll`'s rising-edge detector calls), so it automatically
// respects the exclusive-claim stack, screen-level action handlers, and
// spatial-nav focus — none of that routing is duplicated or changed here.
// Native controls (inputs/selects/textareas/contenteditable) keep their own
// built-in key handling for everything except Escape, which always closes
// the nearest overlay/menu regardless of focus (matching every existing
// per-dialog Escape handler already in this codebase). A natively
// activatable target (a real <button>/<a>, or an activatable ARIA role) also
// keeps its own Enter/Space activation — see `isNativeActivationTarget`'s
// doc in keyboardMap.ts for why `confirm` must yield to it specifically.

import { useEffect } from "react";
import type { SemanticAction } from "./actions";
import {
  isControlGuardExempt,
  isNativeActivationTarget,
  isNativeControlTarget,
  keyToSemanticAction,
  type KeyTargetLike,
} from "./keyboardMap";

/** Read the resolved ARIA `role` + `disabled` state off a real DOM node,
 * narrowed to the minimal shape `keyboardMap.ts`'s pure predicates need —
 * keeps the DOM-reading concern in this impure hook and the classification
 * logic itself framework-free and unit-testable without jsdom. */
function describeTarget(target: EventTarget | null): KeyTargetLike | null {
  if (!(target instanceof Element)) return null;
  return {
    tagName: target.tagName,
    isContentEditable: target instanceof HTMLElement && target.isContentEditable,
    role: target.getAttribute("role"),
    disabled: "disabled" in target ? Boolean((target as { disabled?: boolean }).disabled) : false,
  };
}

export interface KeyboardNavOptions {
  /** Forwards a resolved semantic action to the shared dispatch. */
  dispatchAction: (action: SemanticAction) => void;
  /** Disable the bridge entirely (e.g. tests that don't want a global
   * listener installed). Defaults to enabled. */
  enabled?: boolean;
}

/**
 * Installs a single window-level `keydown` listener translating
 * arrows/Enter/Space/Escape into semantic actions via `dispatchAction`. Keys
 * this module has no opinion on (everything else) are left completely alone
 * — no `preventDefault`, no stopPropagation — so unrelated browser/native
 * behaviour (e.g. Cmd+T's app-level accelerator in App.tsx, F11 fullscreen)
 * is entirely unaffected.
 */
export function useKeyboardNav(opts: KeyboardNavOptions): void {
  const { dispatchAction, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const onKeyDown = (e: KeyboardEvent) => {
      // A screen with its own local keyboard handling (e.g. CoresPage/
      // SystemList's column-switch ArrowLeft/Right, the per-dialog Escape
      // handlers) already called `preventDefault()` on this same key by the
      // time it reaches window — respecting that avoids this global bridge
      // ALSO dispatching a semantic action for a key a screen already fully
      // handled itself (the two would otherwise both react to one press).
      if (e.defaultPrevented) return;

      const action = keyToSemanticAction(e.key);
      if (!action) return;

      const target = describeTarget(e.target);
      if (isNativeControlTarget(target) && !isControlGuardExempt(e.key)) {
        return; // let the native control (input/select/textarea) handle its own key
      }

      // `confirm` (Enter/Space) is the one bridged action a NATIVELY
      // activatable target (a real <button>/<a>, or an activatable ARIA
      // role) already handles entirely on its own via the browser's default
      // action — most of this app's buttons never registered with the
      // spatial-nav focus registry (useFocusable), so dispatching `confirm`
      // through the semantic layer for one of THOSE would look up whatever
      // the controller-focus registry separately thinks is focused (stale or
      // nothing), not this button — see keyboardMap.ts's
      // `NATIVE_ACTIVATION_TAGS` doc. Arrows/Escape are never native-
      // activation concerns (no browser default to conflict with), so only
      // `confirm` needs this extra check.
      if (action === "confirm" && isNativeActivationTarget(target)) {
        return; // let the native button/link's own click-on-Enter/Space fire
      }

      // Arrows/Enter/Space would otherwise scroll the page or activate
      // whatever native element currently holds focus (e.g. a re-click of a
      // button) in addition to the semantic dispatch below — prevent that
      // double-fire, mirroring NativePlayer/InPagePlayer's existing
      // `e.preventDefault()` before dispatching their own bound keys.
      e.preventDefault();
      dispatchAction(action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatchAction, enabled]);
}
