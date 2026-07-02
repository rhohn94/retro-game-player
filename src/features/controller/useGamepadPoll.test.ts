// Unit tests for the pure, testable surface of useGamepadPoll (W268): the
// non-standard-mapping degradation-notice funnel. The rAF polling loop itself
// needs a live `navigator.getGamepads`/hardware and is integration-verified on
// a real pad (design doc §1), matching the existing actions.test.ts /
// spatial.test.ts pattern of testing the pure logic without hardware.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeMappingDegradation,
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
