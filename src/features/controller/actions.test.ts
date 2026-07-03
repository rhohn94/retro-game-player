// Unit tests for the pure semantic-mapping + family-default logic (W14). No
// gamepad hardware required — this is the testable heart of the input layer.

import { describe, expect, it } from "vitest";
import {
  STANDARD_BUTTON,
  buttonNameToIndex,
  classifyMapping,
  defaultBindings,
  detectFamily,
  detectPlayStationModel,
  isStandardMapping,
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

  // Data-driven, real-world macOS Gamepad.id strings (compat-matrix ids, W268).
  // One row per id string named in the release-plan acceptance criteria:
  // Xbox wired/BT, DualShock 4, DualSense, 8BitDo, Switch Pro.
  const REAL_WORLD_IDS: ReadonlyArray<{ id: string; expected: ReturnType<typeof detectFamily> }> = [
    // Xbox — Chromium-style vendor/product hex tag (wired + Bluetooth report the
    // same vendor id; BT adds "Wireless" to the name but the hex tag is what matters).
    { id: "Xbox Wired Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)", expected: "xbox" },
    { id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)", expected: "xbox" },
    { id: "045e-0b13-Xbox Wireless Controller", expected: "xbox" },
    { id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", expected: "xbox" },
    { id: "Xbox One Controller", expected: "xbox" },
    // DualShock 4 — bare name (macOS WKWebView, no hex tag) and Chromium-style hex.
    { id: "DUALSHOCK 4 Wireless Controller", expected: "playstation" },
    { id: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 05c4)", expected: "playstation" },
    { id: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)", expected: "playstation" },
    // DualSense (PS5) — bare name and hex tag.
    { id: "DualSense Wireless Controller", expected: "playstation" },
    { id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", expected: "playstation" },
    // 8BitDo.
    { id: "8BitDo SN30 Pro (STANDARD GAMEPAD Vendor: 2dc8 Product: 6001)", expected: "8bitdo" },
    { id: "2dc8-6001-8BitDo SN30 Pro", expected: "8bitdo" },
    // Switch Pro — bare name (macOS) and hex tag.
    { id: "Pro Controller", expected: "switch_pro" },
    { id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)", expected: "switch_pro" },
  ];

  it.each(REAL_WORLD_IDS)("detects $expected for id $id", ({ id, expected }) => {
    expect(detectFamily(id)).toBe(expected);
  });
});

describe("detectPlayStationModel", () => {
  it("distinguishes DualShock 4 from DualSense by product hex id", () => {
    expect(
      detectPlayStationModel("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 05c4)"),
    ).toBe("dualshock4");
    expect(
      detectPlayStationModel("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"),
    ).toBe("dualshock4");
    expect(
      detectPlayStationModel(
        "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
      ),
    ).toBe("dualsense");
  });

  it("falls back to name substrings when no hex tag is present", () => {
    expect(detectPlayStationModel("DUALSHOCK 4 Wireless Controller")).toBe("dualshock4");
    expect(detectPlayStationModel("DualSense Wireless Controller")).toBe("dualsense");
  });

  it("returns null when the model can't be determined", () => {
    expect(detectPlayStationModel("Some Generic Pad")).toBeNull();
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

describe("isStandardMapping / classifyMapping — non-standard fallback (W268)", () => {
  it("treats exactly 'standard' as trusted", () => {
    expect(isStandardMapping("standard")).toBe(true);
    expect(isStandardMapping("")).toBe(false);
    expect(isStandardMapping("xinput")).toBe(false);
  });

  it("classifies a standard pad as not degraded", () => {
    expect(classifyMapping("standard")).toEqual({ degraded: false, mapping: "standard" });
  });

  it("classifies an empty-string mapping (unmapped pad) as degraded", () => {
    expect(classifyMapping("")).toEqual({ degraded: true, mapping: "" });
  });

  it("classifies any other non-standard mapping value as degraded", () => {
    expect(classifyMapping("custom-vendor-mapping")).toEqual({
      degraded: true,
      mapping: "custom-vendor-mapping",
    });
  });
});
