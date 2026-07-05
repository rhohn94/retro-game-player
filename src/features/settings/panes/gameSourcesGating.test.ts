// Unit tests for GameSourcesPane's pure gating/validation logic (v0.31 W313
// acceptance: "shortlist confirm gate works"; "form validates name/target").
// W324: imports the real extracted helpers from gameSourcesGating.ts instead
// of re-implementing mirrors of the pane's inline logic.
import { describe, it, expect } from "vitest";

import { manualNameError, manualTargetError, manualTargetLabel, selectChecked } from "./gameSourcesGating";

describe("game sources: app-shortlist confirm gate", () => {
  it("confirms only the checked rows", () => {
    const rows = [
      { item: "A", checked: true },
      { item: "B", checked: false },
      { item: "C", checked: true },
    ];
    expect(selectChecked(rows)).toEqual(["A", "C"]);
  });

  it("confirms nothing when every row is unchecked", () => {
    const rows = [
      { item: "A", checked: false },
      { item: "B", checked: false },
    ];
    expect(selectChecked(rows)).toEqual([]);
  });

  it("confirms everything when every row starts checked (the default)", () => {
    const rows = [
      { item: "A", checked: true },
      { item: "B", checked: true },
    ];
    expect(selectChecked(rows)).toEqual(["A", "B"]);
  });
});

describe("game sources: manual-entry validation", () => {
  it("rejects an empty name", () => {
    expect(manualNameError("")).toMatch(/required/i);
    expect(manualNameError("   ")).toMatch(/required/i);
  });

  it("accepts a non-empty name", () => {
    expect(manualNameError("My Game")).toBeNull();
  });

  it("rejects a missing target", () => {
    expect(manualTargetError(null)).toMatch(/choose/i);
  });

  it("accepts a chosen target", () => {
    expect(manualTargetError({ kind: "app", bundlePath: "/Applications/X.app" })).toBeNull();
  });
});

describe("game sources: manual-target picker label", () => {
  it("prompts to choose when no target is set", () => {
    expect(manualTargetLabel(null)).toBe("Choose target…");
  });

  it("shows the app bundle's basename", () => {
    expect(manualTargetLabel({ kind: "app", bundlePath: "/Applications/Foo.app" })).toBe("Foo.app");
  });

  it("shows the executable's basename", () => {
    expect(
      manualTargetLabel({ kind: "exec", program: "/usr/local/bin/foo", args: [] }),
    ).toBe("foo");
  });
});
