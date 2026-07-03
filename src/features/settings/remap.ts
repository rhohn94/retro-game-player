// Pure press-to-rebind logic for the Controllers settings pane (W267,
// controller-input-design.md §Remapping UI). No DOM, no Gamepad API, no IPC —
// this module only maps between a `BindingMap`, a captured raw button index,
// and the conflict-resolution choice the user makes, so the whole rebind
// pipeline is fully unit-testable without controller hardware. The pane
// (`ControllersPane.tsx`) is the only impure caller.

import {
  SEMANTIC_ACTIONS,
  STANDARD_BUTTON,
  type BindingMap,
  type DeviceFamily,
  type SemanticAction,
} from "../controller";

/**
 * Sentinel button index meaning "no button assigned". Real Gamepad API button
 * indices are always >= 0, so this can never collide with a captured press —
 * `risingActions`/`useGamepadPoll` simply never fire an action bound to it.
 */
export const UNBOUND = -1;

/** Reverse lookup: STANDARD_BUTTON index -> its named key (e.g. 0 -> "faceDown"). */
const INDEX_TO_NAME = new Map<number, string>(
  Object.entries(STANDARD_BUTTON).map(([name, idx]) => [idx, name]),
);

/**
 * Translate a captured button index to the token persisted via `setBinding`.
 * Named STANDARD_BUTTON indices persist as their key (matches the storage
 * convention `buttonNameToIndex` in actions.ts already reads); any other index
 * (e.g. an extra shoulder/paddle button on a non-standard pad) persists as its
 * plain numeric string so it round-trips through `resolveBindings` unharmed.
 */
export function buttonIndexToStoredName(index: number): string {
  return INDEX_TO_NAME.get(index) ?? String(index);
}

/** Human-readable fallback label for a raw button index (used when no glyph fits). */
export function buttonDisplayLabel(index: number): string {
  if (index === UNBOUND) return "Unassigned";
  const name = INDEX_TO_NAME.get(index);
  if (!name) return `Button ${index}`;
  // "faceDown" -> "Face Down", "dpadUp" -> "Dpad Up".
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** One row of the rebind table: a semantic action and its bound button index. */
export interface BindingRow {
  action: SemanticAction;
  buttonIndex: number;
}

/** Build the ordered table of rows the pane renders for one binding map. */
export function bindingRows(bindings: BindingMap): BindingRow[] {
  return SEMANTIC_ACTIONS.map((action) => ({ action, buttonIndex: bindings[action] }));
}

/**
 * Find another action already bound to `buttonIndex`, if any (excluding
 * `action` itself, and excluding UNBOUND which every unassigned action shares).
 * Returns null when the button is free — the common, no-conflict rebind path.
 */
export function findConflict(
  bindings: BindingMap,
  action: SemanticAction,
  buttonIndex: number,
): SemanticAction | null {
  if (buttonIndex === UNBOUND) return null;
  for (const other of SEMANTIC_ACTIONS) {
    if (other === action) continue;
    if (bindings[other] === buttonIndex) return other;
  }
  return null;
}

/** How to resolve a rebind that collides with an existing binding. */
export type ConflictResolution = "swap" | "clear";

/**
 * Pure merge: apply a captured `buttonIndex` to `action` within `bindings`.
 *
 * - No conflict: `action` simply takes `buttonIndex`; every other entry is
 *   unchanged.
 * - Conflict + `"swap"`: `action` takes `buttonIndex`; the previously-conflicting
 *   action takes `action`'s old button (both stay bound, just exchanged).
 * - Conflict + `"clear"`: `action` takes `buttonIndex`; the previously-
 *   conflicting action becomes `UNBOUND`.
 * - Conflict + no resolution given: returns the map unchanged (caller must ask
 *   the user swap-or-clear before calling again) — this keeps the function
 *   total and side-effect-free rather than throwing.
 *
 * Always returns a new object; `bindings` is never mutated.
 */
export function applyRebind(
  bindings: BindingMap,
  action: SemanticAction,
  buttonIndex: number,
  resolution?: ConflictResolution,
): BindingMap {
  const conflict = findConflict(bindings, action, buttonIndex);
  if (!conflict) {
    return { ...bindings, [action]: buttonIndex };
  }
  if (!resolution) {
    return { ...bindings }; // No-op copy; caller must resolve the conflict first.
  }
  const prevButton = bindings[action];
  return {
    ...bindings,
    [action]: buttonIndex,
    [conflict]: resolution === "swap" ? prevButton : UNBOUND,
  };
}

/** The compiled-in family plus every persisted `(action, button)` override row. */
export interface OverrideRow {
  action: string;
  button: string;
}

/**
 * Compute the minimal set of `setBinding` calls needed to move from `from` to
 * `to` (only the actions whose button actually changed) — so a rebind/swap
 * persists exactly the rows that changed, not the whole table.
 */
export function diffBindings(from: BindingMap, to: BindingMap): OverrideRow[] {
  const changed: OverrideRow[] = [];
  for (const action of SEMANTIC_ACTIONS) {
    if (from[action] !== to[action]) {
      changed.push({ action, button: buttonIndexToStoredName(to[action]) });
    }
  }
  return changed;
}

/** Capture-mode timeout (ms) — auto-cancel if no button is pressed in time. */
export const CAPTURE_TIMEOUT_MS = 8000;

/** A device family's display name for the pane's per-family section headers. */
export const FAMILY_LABEL: Record<DeviceFamily, string> = {
  xbox: "Xbox",
  playstation: "PlayStation",
  "8bitdo": "8BitDo",
  switch_pro: "Switch Pro",
  generic: "Generic",
};

/** Display label for one semantic action in the rebind table's left column. */
export const ACTION_LABEL: Record<SemanticAction, string> = {
  confirm: "Confirm",
  back: "Back",
  nav_up: "Navigate Up",
  nav_down: "Navigate Down",
  nav_left: "Navigate Left",
  nav_right: "Navigate Right",
  menu: "Menu",
  quit: "Quit",
};
