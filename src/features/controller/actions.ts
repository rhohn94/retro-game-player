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

// ── Device identification (W268, controller-input-design.md §compat matrix) ──
//
// The Gamepad API's `id` string is not standardized across browsers/OSes: some
// report "<name> (Vendor: 054c Product: 0ce6)" (Chromium-style hex sniff),
// others just a bare product name (WKWebView on macOS often reports the HID
// product string verbatim, e.g. "DualSense Wireless Controller"). We prefer
// vendor/product hex sniffing when present (it's authoritative and immune to
// firmware-name drift) and fall back to name-substring matching otherwise.
// Table-driven so each real-world id string in the compat matrix has exactly
// one row to maintain and one unit-test data point (actions.test.ts).

/** One USB HID vendor ID (hex, lowercase, no "0x" prefix) recognised below. */
const VENDOR_ID = {
  sony: "054c",
  microsoft: "045e",
  bitdo8: "2dc8",
  nintendo: "057e",
} as const;

/** Sony product IDs that distinguish DualShock 4 vs DualSense pads. */
const SONY_PRODUCT_ID = {
  // DualShock 4: original (05c4) and the v2/slim revision (09cc).
  dualShock4: ["05c4", "09cc"],
  // DualSense (PS5).
  dualSense: ["0ce6"],
} as const;

/** A detection rule: vendor/product hex sniff (preferred) and/or a name regex fallback. */
interface FamilyRule {
  family: DeviceFamily;
  /** Matches a "vendor: XXXX" or "(XXXX-YYYY-...)" style hex tag in the id string. */
  vendorHex?: string;
  /** Case-insensitive substring/regex match against the full id string, used
   * when no vendor hex is present (or to disambiguate within a vendor). */
  nameMatch?: RegExp;
}

// Extracts a 4-hex-digit vendor id from common Gamepad `id` shapes:
//  - Chromium/Electron: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)"
//  - Firefox: "045e-0b13-Xbox Wireless Controller"
const VENDOR_HEX_RE = /vendor[:\s]+([0-9a-f]{4})|^([0-9a-f]{4})-[0-9a-f]{4}-/i;
const PRODUCT_HEX_RE = /product[:\s]+([0-9a-f]{4})|^[0-9a-f]{4}-([0-9a-f]{4})-/i;

/** Pull the vendor hex id out of a lowercased Gamepad `id` string, if present. */
function extractVendorHex(id: string): string | null {
  const m = VENDOR_HEX_RE.exec(id);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** Pull the product hex id out of a lowercased Gamepad `id` string, if present. */
function extractProductHex(id: string): string | null {
  const m = PRODUCT_HEX_RE.exec(id);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

// Ordered detection table: first match wins. PlayStation entries are split so
// DualSense vs DualShock 4 can be told apart by product id when a vendor hex
// is present, falling back to name substrings (macOS WKWebView commonly
// reports bare names like "DualSense Wireless Controller" with no hex tag).
const FAMILY_RULES: readonly FamilyRule[] = [
  { family: "xbox", vendorHex: VENDOR_ID.microsoft },
  { family: "xbox", nameMatch: /(xbox|xinput)/ },
  { family: "playstation", nameMatch: /(dualsense|dualshock|ps[345]\b|wireless controller)/ },
  { family: "playstation", vendorHex: VENDOR_ID.sony },
  { family: "playstation", nameMatch: /(playstation|sony)/ },
  { family: "8bitdo", vendorHex: VENDOR_ID.bitdo8 },
  { family: "8bitdo", nameMatch: /8bitdo/ },
  { family: "switch_pro", vendorHex: VENDOR_ID.nintendo },
  { family: "switch_pro", nameMatch: /(switch pro|pro controller|nintendo)/ },
];

/**
 * Detect the device family from the Gamepad `id` string. Prefers a vendor
 * hex-id sniff (authoritative, immune to firmware-name drift across OS/browser
 * revisions); falls back to name-substring matching for platforms (notably
 * macOS WKWebView) that report a bare product name with no hex tag. Returns
 * `generic` when nothing matches.
 */
export function detectFamily(gamepadId: string): DeviceFamily {
  const id = gamepadId.toLowerCase();
  const vendorHex = extractVendorHex(id);
  for (const rule of FAMILY_RULES) {
    if (rule.vendorHex && vendorHex === rule.vendorHex) return rule.family;
  }
  for (const rule of FAMILY_RULES) {
    if (rule.nameMatch && rule.nameMatch.test(id)) return rule.family;
  }
  return "generic";
}

/**
 * Distinguish DualShock 4 from DualSense within the `playstation` family, for
 * surfaces that need the finer-grained pad model (e.g. glyph labels that
 * differ — "Share" on DS4 vs "Create" on DualSense). Prefers the Sony product
 * hex id; falls back to name substrings; `null` when it can't be determined
 * (still `playstation` family, just an unknown specific model).
 */
export type PlayStationModel = "dualshock4" | "dualsense" | null;

export function detectPlayStationModel(gamepadId: string): PlayStationModel {
  const id = gamepadId.toLowerCase();
  const productHex = extractProductHex(id);
  if (productHex) {
    if ((SONY_PRODUCT_ID.dualSense as readonly string[]).includes(productHex)) return "dualsense";
    if ((SONY_PRODUCT_ID.dualShock4 as readonly string[]).includes(productHex)) return "dualshock4";
  }
  if (/dualsense/.test(id)) return "dualsense";
  if (/(dualshock|dualshock\s*4|wireless controller)/.test(id)) return "dualshock4";
  return null;
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

// ── Non-standard mapping fallback (W268, controller-input-design.md §compat matrix) ──
//
// The W3C Gamepad API only guarantees button/axis *positions* line up with
// `STANDARD_BUTTON` when `Gamepad.mapping === "standard"`. Some third-party
// pads (older 8BitDo firmware, some no-name pads) report `mapping === ""`
// (empty string — the API's spelling of "no recognised mapping"). Silently
// applying STANDARD_BUTTON indices to an unmapped pad can produce dead or
// cross-wired input, so callers must classify the pad and surface a visible
// degradation hint rather than pretend the mapping is fine.

/** A Gamepad's reported mapping, minimally typed so this stays test-friendly. */
export type GamepadMapping = "standard" | "" | string;

/**
 * Classify whether a pad's mapping can be trusted. `"standard"` is the only
 * mapping the W3C spec defines index semantics for; anything else (empty
 * string, or a future non-standard value) is a best-effort fallback — we still
 * apply STANDARD_BUTTON indices (most pads that fail to report "standard" are
 * still physically standard-shaped), but the caller must show the degradation
 * hint so the user knows to check Settings → Controllers if input feels wrong.
 */
export function isStandardMapping(mapping: GamepadMapping): boolean {
  return mapping === "standard";
}

/** Degradation classification for a polled pad, keyed off `Gamepad.mapping`. */
export interface MappingClassification {
  /** True when the mapping is untrusted (non-"standard") and a fallback applies. */
  degraded: boolean;
  /** The raw mapping string as reported (for diagnostics/logging). */
  mapping: GamepadMapping;
}

/**
 * Classify a pad's mapping for the fallback path. Pure so it's unit-testable
 * without hardware; `useGamepadPoll` calls this once per newly-seen pad and
 * surfaces {@link degraded} via the controller degradation-notice module.
 */
export function classifyMapping(mapping: GamepadMapping): MappingClassification {
  return { degraded: !isStandardMapping(mapping), mapping };
}
