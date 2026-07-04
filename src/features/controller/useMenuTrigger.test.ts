// Unit tests for the pure, testable surface of useMenuTrigger (v0.28 W278):
// the per-tick "is the trigger down" classifier. The rAF polling loop itself
// needs a live `navigator.getGamepads`/hardware, matching the existing
// useLongPress.test.ts / useGamepadPoll.test.ts pattern of testing the pure
// logic without hardware.

import { describe, expect, it } from "vitest";
import { STANDARD_BUTTON } from "./actions";
import { isMenuTriggerPressed } from "./useMenuTrigger";

/** A minimal button array where only the given indices report pressed. */
function padWithPressed(...indices: number[]): { buttons: { pressed: boolean }[] } {
  const max = Math.max(0, ...indices);
  const buttons = Array.from({ length: max + 1 }, () => ({ pressed: false }));
  for (const i of indices) buttons[i] = { pressed: true };
  return { buttons };
}

describe("isMenuTriggerPressed", () => {
  it("reads Select as pressed for every family", () => {
    const pad = padWithPressed(STANDARD_BUTTON.select);
    for (const fam of ["xbox", "playstation", "8bitdo", "switch_pro", "generic"] as const) {
      expect(isMenuTriggerPressed(pad, fam)).toBe(true);
    }
  });

  it("reads the PlayStation touchpad as pressed too (aux binding)", () => {
    const pad = padWithPressed(STANDARD_BUTTON.touchpad);
    expect(isMenuTriggerPressed(pad, "playstation")).toBe(true);
  });

  it("ignores the touchpad button index on non-PlayStation families", () => {
    const pad = padWithPressed(STANDARD_BUTTON.touchpad);
    for (const fam of ["xbox", "8bitdo", "switch_pro", "generic"] as const) {
      expect(isMenuTriggerPressed(pad, fam)).toBe(false);
    }
  });

  it("is true when both Select and the touchpad are pressed together", () => {
    const pad = padWithPressed(STANDARD_BUTTON.select, STANDARD_BUTTON.touchpad);
    expect(isMenuTriggerPressed(pad, "playstation")).toBe(true);
  });

  it("is false when neither button is pressed", () => {
    const pad = padWithPressed();
    expect(isMenuTriggerPressed(pad, "playstation")).toBe(false);
  });

  it("resolves a rebound quit override for the primary button", () => {
    // A rebind moves quit off Select onto some other button; the trigger
    // must follow the rebind for the primary path (aux touchpad is untouched
    // by the rebind — it is an independent additive binding).
    const pad = padWithPressed(STANDARD_BUTTON.faceUp);
    const overrides = [{ deviceFamily: "xbox", action: "quit", button: "faceUp" }];
    expect(isMenuTriggerPressed(pad, "xbox", overrides)).toBe(true);
    expect(isMenuTriggerPressed(padWithPressed(STANDARD_BUTTON.select), "xbox", overrides)).toBe(
      false,
    );
  });
});
