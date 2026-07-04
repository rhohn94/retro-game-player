// Unit tests for controlKind's pure classification (v0.29 W282).
import { describe, it, expect } from "vitest";
import { classifyControl, controlKindFor, numericSteps } from "./controlKind";

describe("classifyControl", () => {
  it("classifies enabled/disabled as bool", () => {
    expect(classifyControl(["enabled", "disabled"])).toBe("bool");
    expect(classifyControl(["disabled", "enabled"])).toBe("bool");
  });

  it("classifies on/off, true/false, yes/no as bool (case-insensitive)", () => {
    expect(classifyControl(["On", "Off"])).toBe("bool");
    expect(classifyControl(["true", "false"])).toBe("bool");
    expect(classifyControl(["Yes", "No"])).toBe("bool");
  });

  it("classifies an all-numeric choice list as range", () => {
    expect(classifyControl(["0", "1", "2", "3"])).toBe("range");
    expect(classifyControl(["1.0", "1.5", "2.0"])).toBe("range");
  });

  it("classifies a three-way enum as select", () => {
    expect(classifyControl(["auto", "ntsc", "pal"])).toBe("select");
  });

  it("classifies a single-choice option as select", () => {
    expect(classifyControl(["only-choice"])).toBe("select");
  });

  it("classifies an empty choice list as select (never crashes)", () => {
    expect(classifyControl([])).toBe("select");
  });

  it("does not misclassify a two-way non-boolean enum as bool", () => {
    expect(classifyControl(["ntsc", "pal"])).toBe("select");
  });

  it("does not misclassify two numeric-looking values that also happen to be boolean words", () => {
    // "0"/"1" is numeric, not the recognized enabled/disabled-style pair —
    // range classification should win since both parse as numbers.
    expect(classifyControl(["0", "1"])).toBe("range");
  });
});

describe("controlKindFor", () => {
  it("delegates to classifyControl using the option's choices", () => {
    expect(controlKindFor({ choices: ["enabled", "disabled"] })).toBe("bool");
    expect(controlKindFor({ choices: ["auto", "ntsc", "pal"] })).toBe("select");
  });
});

describe("numericSteps", () => {
  it("sorts numeric choices ascending regardless of declaration order", () => {
    expect(numericSteps(["3", "1", "2", "0"])).toEqual([0, 1, 2, 3]);
  });

  it("returns an empty array for an empty choice list", () => {
    expect(numericSteps([])).toEqual([]);
  });
});
