// Semantic action layer (W14, controller-input-design.md §2). Maps raw gamepad
// inputs (standard-mapping button indices + analog-stick axes) to the small set
// of SEMANTIC ACTIONS the UI reacts to, with per-family defaults. This module is
// intentionally pure (no DOM, no gamepad polling) so the mapping + family-default
// logic is fully unit-testable without controller hardware.

/** The semantic actions every screen understands (architecture-design.md §2.10). */
export type SemanticAction =
  | "confirm"
  | "back"
  | "nav_up"
  | "nav_down"
  | "nav_left"
  | "nav_right"
  | "menu"
  | "quit";

export const SEMANTIC_ACTIONS: readonly SemanticAction[] = [
  "confirm",
  "back",
  "nav_up",
  "nav_down",
  "nav_left",
  "nav_right",
  "menu",
  "quit",
];

/** Recognised controller device families. `generic` is the fallback. */
export type DeviceFamily =
  | "xbox"
  | "playstation"
  | "8bitdo"
  | "switch_pro"
  | "generic";

export const DEVICE_FAMILIES: readonly DeviceFamily[] = [
  "xbox",
  "playstation",
  "8bitdo",
  "switch_pro",
  "generic",
];

// Standard-mapping button indices (W3C Gamepad API "standard" layout). Named so
// the family-default tables read intention-first rather than via magic numbers.
export const STANDARD_BUTTON = {
  /** Bottom face button (Xbox A, PS Cross, Nintendo B-position). */
  faceDown: 0,
  /** Right face button (Xbox B, PS Circle, Nintendo A-position). */
  faceRight: 1,
  /** Left face button (Xbox X, PS Square, Nintendo Y-position). */
  faceLeft: 2,
  /** Top face button (Xbox Y, PS Triangle, Nintendo X-position). */
  faceUp: 3,
  start: 9,
  select: 8,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

/** A binding map: semantic action -> the standard-mapping button index that fires it. */
export type BindingMap = Record<SemanticAction, number>;

// D-pad bindings are family-invariant; only confirm/back swap by family.
const DPAD_BINDINGS = {
  nav_up: STANDARD_BUTTON.dpadUp,
  nav_down: STANDARD_BUTTON.dpadDown,
  nav_left: STANDARD_BUTTON.dpadLeft,
  nav_right: STANDARD_BUTTON.dpadRight,
  menu: STANDARD_BUTTON.start,
  quit: STANDARD_BUTTON.select,
} as const;

// Confirm/back face-button assignment per family. Xbox / PlayStation / 8BitDo
// confirm with the BOTTOM face button and back with the RIGHT one. Nintendo
// Switch Pro physically swaps the A/B legend, so its confirm/back are mirrored —
// the classic "confirm/back swap by family" requirement (design §2.2).
const CONFIRM_BACK: Record<DeviceFamily, { confirm: number; back: number }> = {
  xbox: { confirm: STANDARD_BUTTON.faceDown, back: STANDARD_BUTTON.faceRight },
  playstation: { confirm: STANDARD_BUTTON.faceDown, back: STANDARD_BUTTON.faceRight },
  "8bitdo": { confirm: STANDARD_BUTTON.faceDown, back: STANDARD_BUTTON.faceRight },
  switch_pro: { confirm: STANDARD_BUTTON.faceRight, back: STANDARD_BUTTON.faceDown },
  generic: { confirm: STANDARD_BUTTON.faceDown, back: STANDARD_BUTTON.faceRight },
};

/** The compiled-in default binding map for a device family. */
export function defaultBindings(family: DeviceFamily): BindingMap {
  const { confirm, back } = CONFIRM_BACK[family];
  return { confirm, back, ...DPAD_BINDINGS };
}

/**
 * Detect the device family from the Gamepad `id` string. WebKit/Chromium report
 * vendor/product strings or human-readable names; we match on robust substrings,
 * falling back to `generic`.
 */
export function detectFamily(gamepadId: string): DeviceFamily {
  const id = gamepadId.toLowerCase();
  if (/(xbox|xinput|microsoft|045e)/.test(id)) return "xbox";
  if (/(playstation|dualshock|dualsense|sony|054c|ps[345])/.test(id)) return "playstation";
  if (/(8bitdo|2dc8)/.test(id)) return "8bitdo";
  if (/(switch pro|pro controller|nintendo|057e)/.test(id)) return "switch_pro";
  return "generic";
}

/**
 * Resolve the effective binding map: start from the family defaults, then apply
 * persisted overrides. Each override names `(action, button)` where `button` is
 * a STANDARD_BUTTON key (e.g. `"faceDown"`) or a numeric index string; unknown
 * actions/buttons are ignored so a stale DB row can never crash input.
 */
export function resolveBindings(
  family: DeviceFamily,
  overrides: ReadonlyArray<{ action: string; button: string }> = [],
): BindingMap {
  const map = defaultBindings(family);
  for (const o of overrides) {
    if (!(o.action in map)) continue;
    const idx = buttonNameToIndex(o.button);
    if (idx !== null) map[o.action as SemanticAction] = idx;
  }
  return map;
}

/** Translate a stored button token to a standard button index, or null if unknown. */
export function buttonNameToIndex(button: string): number | null {
  if (button in STANDARD_BUTTON) {
    return STANDARD_BUTTON[button as keyof typeof STANDARD_BUTTON];
  }
  const n = Number(button);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// Analog-stick deadzone: below this magnitude a stick axis reports no direction,
// so resting drift never spams nav actions (design §2.3).
export const STICK_DEADZONE = 0.5;

/**
 * Map a left-analog-stick (x, y) sample to a single nav action, or null inside
 * the deadzone. The dominant axis wins so a diagonal push resolves to one move,
 * matching D-pad semantics. Gamepad axes: +y is DOWN, +x is RIGHT.
 */
export function stickToNav(x: number, y: number): SemanticAction | null {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < STICK_DEADZONE && ay < STICK_DEADZONE) return null;
  if (ax >= ay) return x > 0 ? "nav_right" : "nav_left";
  return y > 0 ? "nav_down" : "nav_up";
}

/**
 * Given the previous and current pressed-button index sets and a binding map,
 * return the semantic actions that fired this frame — i.e. buttons that are
 * pressed now but were NOT pressed last frame (rising edge). This makes a single
 * press fire exactly one action regardless of poll rate.
 */
export function risingActions(
  bindings: BindingMap,
  prevPressed: ReadonlySet<number>,
  nowPressed: ReadonlySet<number>,
): SemanticAction[] {
  const fired: SemanticAction[] = [];
  for (const action of SEMANTIC_ACTIONS) {
    const idx = bindings[action];
    if (nowPressed.has(idx) && !prevPressed.has(idx)) fired.push(action);
  }
  return fired;
}
