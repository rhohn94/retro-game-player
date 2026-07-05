import { describe, expect, it } from "vitest";
import { playerCountAriaLabel, playerCountLabel } from "./playerCountLabel";

describe("playerCountLabel", () => {
  it("shows P1 alone with no gamepad connected (keyboard still drives port 0)", () => {
    expect(playerCountLabel(0)).toBe("P1");
  });

  it("shows P1 alone with one gamepad connected", () => {
    expect(playerCountLabel(1)).toBe("P1");
  });

  it("shows P1 P2 with two gamepads connected", () => {
    expect(playerCountLabel(2)).toBe("P1 P2");
  });
});

describe("playerCountAriaLabel", () => {
  it("announces the keyboard-only state without claiming a controller is connected", () => {
    expect(playerCountAriaLabel(0)).toBe("No controller connected — keyboard plays as player one");
  });

  it("announces one connected controller", () => {
    expect(playerCountAriaLabel(1)).toBe("One controller connected");
  });

  it("announces two connected controllers", () => {
    expect(playerCountAriaLabel(2)).toBe("Two controllers connected");
  });
});
