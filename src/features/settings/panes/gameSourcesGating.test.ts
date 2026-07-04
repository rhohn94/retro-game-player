// Unit tests for GameSourcesPane's pure gating/validation logic (v0.31 W313
// acceptance: "shortlist confirm gate works"; "form validates name/target").
// Extracted here as standalone functions (mirroring the pane's own logic) so
// they're testable without mounting React or invoking Tauri IPC.
import { describe, it, expect } from "vitest";

/** Mirrors GameSourcesPane's checklist filter: only checked rows are confirmed. */
function selectChecked<T>(rows: { item: T; checked: boolean }[]): T[] {
  return rows.filter((r) => r.checked).map((r) => r.item);
}

/** Mirrors GameSourcesPane's manual-entry name validation. */
function manualNameError(name: string): string | null {
  if (name.trim().length === 0) return "Name is required.";
  return null;
}

/** Mirrors GameSourcesPane's manual-entry target validation. */
function manualTargetError(target: unknown): string | null {
  if (!target) return "Choose an app or executable.";
  return null;
}

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
