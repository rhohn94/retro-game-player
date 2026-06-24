// Unit tests for the pure semantic-mapping + family-default logic (W14). No
// gamepad hardware required — this is the testable heart of the input layer.

import { describe, expect, it } from "vitest";
import {
  STANDARD_BUTTON,
  buttonNameToIndex,
  defaultBindings,
  detectFamily,
  resolveBindings,
  risingActions,
  stickToNav,
} from "./actions";

describe("defaultBindings — per-family confirm/back swap", () => {
  it("Xbox/PlayStation/8BitDo confirm with the bottom face button", () => {
    for (const fam of ["xbox", "playstation", "8bitdo"] as const) {
      const b = defaultBindings(fam);
      expect(b.confirm).toBe(STANDARD_BUTTON.faceDown);
      expect(b.back).toBe(STANDARD_BUTTON.faceRight);
    }
  });

  it("Switch Pro mirrors confirm/back (A on the right)", () => {
    const b = defaultBindings("switch_pro");
    expect(b.confirm).toBe(STANDARD_BUTTON.faceRight);
    expect(b.back).toBe(STANDARD_BUTTON.faceDown);
  });

  it("binds the four D-pad directions invariantly across families", () => {
    const b = defaultBindings("generic");
    expect(b.nav_up).toBe(STANDARD_BUTTON.dpadUp);
    expect(b.nav_down).toBe(STANDARD_BUTTON.dpadDown);
    expect(b.nav_left).toBe(STANDARD_BUTTON.dpadLeft);
    expect(b.nav_right).toBe(STANDARD_BUTTON.dpadRight);
    expect(b.menu).toBe(STANDARD_BUTTON.start);
    expect(b.quit).toBe(STANDARD_BUTTON.select);
  });
});

describe("detectFamily", () => {
  it("classifies known id strings, defaulting to generic", () => {
    expect(detectFamily("Xbox Wireless Controller")).toBe("xbox");
    expect(detectFamily("DualSense Wireless Controller (054c)")).toBe("playstation");
    expect(detectFamily("8BitDo SN30 Pro")).toBe("8bitdo");
    expect(detectFamily("Pro Controller (Nintendo)")).toBe("switch_pro");
    expect(detectFamily("Unknown Pad 1234")).toBe("generic");
  });
});

describe("resolveBindings — overrides fold over defaults", () => {
  it("applies a named-button override and ignores unknown action/button", () => {
    const b = resolveBindings("xbox", [
      { action: "confirm", button: "faceUp" },
      { action: "bogus", button: "faceLeft" },
      { action: "back", button: "not-a-button" },
    ]);
    expect(b.confirm).toBe(STANDARD_BUTTON.faceUp);
    expect(b.back).toBe(STANDARD_BUTTON.faceRight); // unchanged: bad button
  });

  it("accepts a numeric-string override", () => {
    const b = resolveBindings("generic", [{ action: "menu", button: "7" }]);
    expect(b.menu).toBe(7);
  });
});

describe("buttonNameToIndex", () => {
  it("maps names and numeric strings, rejecting junk", () => {
    expect(buttonNameToIndex("faceDown")).toBe(0);
    expect(buttonNameToIndex("3")).toBe(3);
    expect(buttonNameToIndex("-1")).toBeNull();
    expect(buttonNameToIndex("nope")).toBeNull();
  });
});

describe("stickToNav — deadzone + dominant axis", () => {
  it("returns null inside the deadzone", () => {
    expect(stickToNav(0.1, -0.2)).toBeNull();
  });
  it("resolves a diagonal to the dominant axis", () => {
    expect(stickToNav(0.9, -0.6)).toBe("nav_right");
    expect(stickToNav(0.6, -0.9)).toBe("nav_up");
    expect(stickToNav(-0.8, 0.1)).toBe("nav_left");
    expect(stickToNav(0.1, 0.8)).toBe("nav_down");
  });
});

describe("risingActions — edge detection", () => {
  const bindings = defaultBindings("xbox");
  it("fires only on a press that is new this frame", () => {
    const prev = new Set<number>();
    const now = new Set<number>([STANDARD_BUTTON.faceDown]);
    expect(risingActions(bindings, prev, now)).toEqual(["confirm"]);
  });
  it("does not re-fire a held button", () => {
    const held = new Set<number>([STANDARD_BUTTON.faceDown]);
    expect(risingActions(bindings, held, held)).toEqual([]);
  });
});
