// controlKind — classifies a libretro core option's declared `choices` list
// into the UI control archetype the design doc calls for (v0.29 W282,
// core-options-design.md): a bool toggle for a two-way enabled/disabled-style
// choice, a numeric range for an all-numeric choice list, and an enum select
// for everything else. Pure and unit-tested; `CoreOptionsPane` only renders
// the archetype this module picks.

import type { CoreOption } from "../../ipc/core-options";

/** The UI control archetype for one option's declared choices. */
export type ControlKind = "bool" | "range" | "select";

/** Choice-string pairs libretro cores conventionally use for boolean options. */
const BOOL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["enabled", "disabled"],
  ["on", "off"],
  ["true", "false"],
  ["yes", "no"],
];

/** True if `choices` is exactly one of the recognized boolean-style pairs
 * (case-insensitive, either order). */
function isBoolChoices(choices: readonly string[]): boolean {
  if (choices.length !== 2) return false;
  const [a, b] = choices.map((c) => c.toLowerCase());
  return BOOL_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/** True if every choice parses as a finite number (integers or decimals). */
function isNumericChoices(choices: readonly string[]): boolean {
  return choices.length > 0 && choices.every((c) => c.trim() !== "" && Number.isFinite(Number(c)));
}

/**
 * Picks the control archetype for `choices`: `"bool"` for a recognized
 * two-way pair, `"range"` for an all-numeric list (2+ values), else
 * `"select"` — the always-correct fallback for any declared choice list,
 * including a single-choice option or free-form enum values.
 */
export function classifyControl(choices: readonly string[]): ControlKind {
  if (isBoolChoices(choices)) return "bool";
  if (choices.length >= 2 && isNumericChoices(choices)) return "range";
  return "select";
}

/** Convenience overload taking a whole [`CoreOption`]. */
export function controlKindFor(option: Pick<CoreOption, "choices">): ControlKind {
  return classifyControl(option.choices);
}

/**
 * For a `"range"`-classified option, the ordered numeric values the slider
 * steps through — ascending, matching the declared choice order's sort (not
 * necessarily the declaration order, since libretro cores don't guarantee
 * numeric choices are declared in sorted order).
 */
export function numericSteps(choices: readonly string[]): number[] {
  return [...choices.map(Number)].sort((a, b) => a - b).map((n) => n);
}
