// Unit tests for the pure, testable surface of useGamepadPoll: the
// non-standard-mapping degradation-notice funnel (W268) and the D-pad
// hold-to-repeat scheduler (W262). The rAF polling loop itself needs a live
// `navigator.getGamepads`/hardware and is integration-verified on a real pad
// (design doc §1), matching the existing actions.test.ts / spatial.test.ts
// pattern of testing the pure logic without hardware.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NAV_REPEAT_DELAY_MS,
  NAV_REPEAT_INTERVAL_MS,
  describeMappingDegradation,
  navRepeatDue,
  recordMappingDegradation,
  resetMappingDegradationsForTest,
} from "./useGamepadPoll";

describe("mapping-degradation notice funnel", () => {
  beforeEach(() => {
    resetMappingDegradationsForTest();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("describes the notice with a non-empty message and hint", () => {
    const notice = describeMappingDegradation();
    expect(notice.message.length).toBeGreaterThan(0);
    expect(notice.hint.length).toBeGreaterThan(0);
  });

  it("shows a family's degradation once per session but always logs", () => {
    expect(recordMappingDegradation("xbox", "")).toBe(true);
    expect(recordMappingDegradation("xbox", "")).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("tracks each device family independently", () => {
    expect(recordMappingDegradation("xbox", "")).toBe(true);
    expect(recordMappingDegradation("playstation", "custom")).toBe(true);
    expect(recordMappingDegradation("xbox", "")).toBe(false);
    expect(recordMappingDegradation("playstation", "custom")).toBe(false);
  });

  it("logs the raw mapping value for diagnostics", () => {
    recordMappingDegradation("8bitdo", "custom-vendor-mapping");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("custom-vendor-mapping"),
    );
  });
});

describe("navRepeatDue — D-pad hold-to-repeat scheduler (W262)", () => {
  it("does not repeat before the initial delay has elapsed", () => {
    expect(navRepeatDue(0, null)).toBe(false);
    expect(navRepeatDue(NAV_REPEAT_DELAY_MS - 1, null)).toBe(false);
  });

  it("fires the first repeat exactly at the initial delay threshold", () => {
    expect(navRepeatDue(NAV_REPEAT_DELAY_MS, null)).toBe(true);
    expect(navRepeatDue(NAV_REPEAT_DELAY_MS + 50, null)).toBe(true);
  });

  it("uses the shorter interval (not the initial delay) for subsequent repeats", () => {
    // Held far longer than the initial delay, but the last repeat fire was
    // recent (less than the interval) — must NOT fire again yet.
    expect(navRepeatDue(NAV_REPEAT_DELAY_MS * 5, NAV_REPEAT_INTERVAL_MS - 1)).toBe(false);
    expect(navRepeatDue(NAV_REPEAT_DELAY_MS * 5, NAV_REPEAT_INTERVAL_MS)).toBe(true);
  });

  it("honours custom delay/interval overrides", () => {
    expect(navRepeatDue(100, null, 200, 50)).toBe(false);
    expect(navRepeatDue(200, null, 200, 50)).toBe(true);
    expect(navRepeatDue(1000, 49, 200, 50)).toBe(false);
    expect(navRepeatDue(1000, 50, 200, 50)).toBe(true);
  });
});
