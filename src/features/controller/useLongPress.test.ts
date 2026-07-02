// Unit tests for the pure, testable surface of useLongPress (v0.26 W260): the
// held-duration -> fired classification. The rAF polling loop itself needs a
// live `navigator.getGamepads`/hardware, matching the existing
// useGamepadPoll.test.ts pattern of testing the pure logic without hardware.

import { describe, expect, it } from "vitest";
import { LONG_PRESS_MS, longPressElapsed } from "./useLongPress";

describe("longPressElapsed", () => {
  it("has not elapsed before the threshold", () => {
    expect(longPressElapsed(0)).toBe(false);
    expect(longPressElapsed(LONG_PRESS_MS - 1)).toBe(false);
  });

  it("has elapsed exactly at the threshold", () => {
    expect(longPressElapsed(LONG_PRESS_MS)).toBe(true);
  });

  it("has elapsed well past the threshold", () => {
    expect(longPressElapsed(LONG_PRESS_MS * 3)).toBe(true);
  });

  it("honours a custom threshold override", () => {
    expect(longPressElapsed(300, 250)).toBe(true);
    expect(longPressElapsed(200, 250)).toBe(false);
  });
});
