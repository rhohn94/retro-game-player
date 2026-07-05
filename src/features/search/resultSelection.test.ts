/**
 * Direct unit tests for resultSelection.ts (W367 test depth, v0.36).
 *
 * browsing.test.ts already covers the tri-state/group-toggle happy paths;
 * this file adds the branches it left untested: toggling an empty group,
 * and the exact confirm threshold boundary (0 / negative counts).
 */
import { describe, it, expect } from "vitest";
import {
  groupSelectionState,
  withGroupToggled,
  withItemToggled,
  needsOpenConfirm,
  OPEN_CONFIRM_THRESHOLD,
} from "./resultSelection";

describe("withGroupToggled", () => {
  it("toggling an empty group returns an unchanged copy of the selection", () => {
    const selected = new Set(["a"]);
    const out = withGroupToggled([], selected);
    expect(out).not.toBe(selected); // a new Set, per the documented contract
    expect([...out]).toEqual(["a"]);
  });
});

describe("withItemToggled", () => {
  it("adds an item not yet in the set", () => {
    const out = withItemToggled("z", new Set());
    expect(out.has("z")).toBe(true);
  });
});

describe("needsOpenConfirm", () => {
  it("never confirms for zero or negative counts", () => {
    expect(needsOpenConfirm(0)).toBe(false);
    expect(needsOpenConfirm(-1)).toBe(false);
  });

  it("does not confirm at exactly the threshold", () => {
    expect(needsOpenConfirm(OPEN_CONFIRM_THRESHOLD)).toBe(false);
  });

  it("confirms one past the threshold", () => {
    expect(needsOpenConfirm(OPEN_CONFIRM_THRESHOLD + 1)).toBe(true);
  });
});

describe("groupSelectionState", () => {
  it("treats an empty urls array as none regardless of the selection set", () => {
    expect(groupSelectionState([], new Set(["x", "y"]))).toBe("none");
  });
});
