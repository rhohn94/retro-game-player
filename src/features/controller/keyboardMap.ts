// Keyboard → semantic-action mapping (W283, controller-input-design.md
// §Keyboard as an input method). Pure lookup, mirroring the
// `actions.ts`/`resolveBindings` convention of keeping the raw-input →
// SemanticAction translation in a dependency-free, hardware-free, fully
// unit-testable module — the DOM `keydown` listener itself lives in the
// sibling impure hook `useKeyboardNav.ts`, the same pure/impure split every
// other input source in this feature already follows (useGamepadPoll,
// useLongPress, useMenuTrigger).
//
// This is an ADDITIVE input source, not a rebind of the existing gamepad
// bindings: it reads NOTHING from `resolveBindings`/`risingActions` and
// writes NOTHING to `controller_bindings` — a keyboard user gets one fixed,
// familiar arrow-keys/Enter/Space/Escape layout, independent of whatever a
// gamepad's per-family/rebound buttons resolve to. Both input sources feed
// the SAME semantic-action dispatch (`ControllerProvider.dispatchAction`), so
// nothing about spatial nav, the exclusive-claim stack, or screen-level
// action handlers needs to know or care which physical input produced the
// action.

import type { SemanticAction } from "./actions";

/** `KeyboardEvent.key` values this module recognises, named so the lookup
 * table below reads as intent rather than bare string literals. */
const KEY_ARROW_UP = "ArrowUp";
const KEY_ARROW_DOWN = "ArrowDown";
const KEY_ARROW_LEFT = "ArrowLeft";
const KEY_ARROW_RIGHT = "ArrowRight";
const KEY_ENTER = "Enter";
const KEY_SPACE = " ";
const KEY_SPACEBAR_LEGACY = "Spacebar"; // older browser/IME reports (defensive)
const KEY_ESCAPE = "Escape";

/** The fixed keyboard layout: one key (or key-alias) per semantic action this
 * input source drives. `menu`/`quit` have no dedicated key — Escape already
 * covers "back out of/close the current thing" for a keyboard-only user, and
 * a second bespoke key for the rarely-needed extra actions would just be more
 * to document without adding real reach (every destination `menu`/`quit`
 * would otherwise gate stays Tab/Enter reachable as an on-screen control —
 * e.g. TvShell's own ☰ Menu / Exit buttons). */
const KEY_TO_ACTION: Readonly<Record<string, SemanticAction>> = {
  [KEY_ARROW_UP]: "nav_up",
  [KEY_ARROW_DOWN]: "nav_down",
  [KEY_ARROW_LEFT]: "nav_left",
  [KEY_ARROW_RIGHT]: "nav_right",
  [KEY_ENTER]: "confirm",
  [KEY_SPACE]: "confirm",
  [KEY_SPACEBAR_LEGACY]: "confirm",
  [KEY_ESCAPE]: "back",
};

/**
 * Resolve a `KeyboardEvent.key` to the semantic action it should dispatch, or
 * `null` when this module has no opinion on that key (every other key is left
 * completely alone — normal typing/native-control behaviour is never
 * touched). Pure: no DOM, no listeners, fully unit-testable.
 */
export function keyToSemanticAction(key: string): SemanticAction | null {
  return KEY_TO_ACTION[key] ?? null;
}

/** Form-control tag names that own their own keyboard interaction (text
 * cursor movement, native Enter/Space submit, native <select> arrow-key
 * cycling, checkbox/radio Space-toggle) — the keyboard bridge must never
 * hijack arrows/Enter/Space while one of these (or a contenteditable node) is
 * the event target, or normal text editing / native form controls would
 * break the moment this hook mounts. */
const NATIVE_CONTROL_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Tag names that ALREADY activate themselves on Enter/Space via the
 * browser's own default action — the keyboard bridge must never dispatch a
 * SECOND `confirm` on top of that native activation. This matters far beyond
 * "avoids one redundant call": every focusable element in this codebase
 * (`useFocusable`-registered spatial-nav targets AND the many plain
 * `<button onClick>` elements that never registered with that registry —
 * CoresPage/SystemList, SettingsPage's section tabs, every dialog's Cancel/
 * Save/Confirm button) is a real `<button>`/`<a>`. For the UNREGISTERED
 * ones, dispatching `confirm` through the semantic layer would look up
 * whatever the CONTROLLER-focus registry separately thinks is focused (a
 * stale id from a different screen, or nothing) — not the button the user is
 * actually looking at — so without this guard, pressing Enter on any of
 * those buttons would suppress the native click (via this hook's own
 * `preventDefault`) and replace it with a no-op or a wrong action. Skipping
 * `confirm` here costs nothing for the REGISTERED ones either: their native
 * `onClick` already calls the exact same callback `useFocusable`'s
 * `onActivate` wraps, so the native activation this guard yields to IS the
 * correct action, just fired one layer earlier. */
const NATIVE_ACTIVATION_TAGS: ReadonlySet<string> = new Set(["BUTTON", "A", "SUMMARY"]);

/** ARIA roles that behave like a native button/link for Enter/Space purposes
 * when applied to a non-native element (e.g. a styled `<div role="button">`)
 * — treated the same as `NATIVE_ACTIVATION_TAGS` so a future non-`<button>`
 * activatable control doesn't need a keyboardMap change to stay safe. */
const NATIVE_ACTIVATION_ROLES: ReadonlySet<string> = new Set(["button", "link", "menuitem", "tab"]);

/** A minimal shape of the event target this module needs — narrower than
 * `EventTarget` so the predicate is testable with a plain object, no DOM. */
export interface KeyTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  /** The resolved `role` attribute, if any (case-sensitive, as authored). */
  role?: string | null;
  /** Whether the element is currently disabled (a disabled native control
   * cannot receive focus at all in practice, but stays defensive here). */
  disabled?: boolean;
}

/**
 * True when `target` is a native form control or contenteditable region that
 * should keep exclusive ownership of its own keys. `Escape` is deliberately
 * NOT gated by this (see `isControlGuardExempt` below) — closing an
 * overlay/menu must always work even while a field inside it has focus.
 */
export function isNativeControlTarget(target: KeyTargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return !!target.tagName && NATIVE_CONTROL_TAGS.has(target.tagName);
}

/**
 * True when `target` already activates itself on Enter/Space via the
 * browser's own default action (a real `<button>`/`<a>`/`<summary>`, or an
 * element carrying an activatable ARIA role) and is not disabled. The
 * keyboard bridge must never dispatch `confirm` on top of this — see
 * `NATIVE_ACTIVATION_TAGS`'s doc for the concrete regression this prevents.
 */
export function isNativeActivationTarget(target: KeyTargetLike | null | undefined): boolean {
  if (!target || target.disabled) return false;
  if (target.tagName && NATIVE_ACTIVATION_TAGS.has(target.tagName)) return true;
  return !!target.role && NATIVE_ACTIVATION_ROLES.has(target.role);
}

/**
 * Whether the keyboard bridge should handle `key` even when the event target
 * is a native control. Escape always passes through (closing a dialog/menu
 * must work regardless of which field inside it has focus, matching every
 * existing per-dialog `onKeyDown` Escape handler in this codebase); every
 * other bridged key (arrows/Enter/Space) yields to the native control instead
 * of double-firing alongside its own built-in behaviour.
 */
export function isControlGuardExempt(key: string): boolean {
  return key === KEY_ESCAPE;
}
