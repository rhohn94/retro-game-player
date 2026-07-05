import { describe, expect, it } from "vitest";
import { playerCountLabel } from "./playerCountLabel";

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
