import { describe, expect, it } from "vitest";
import {
  BACKGROUND_BELOW,
  FOREGROUND_ABOVE,
  nextPresentation,
} from "./useAttractPresentation";

describe("nextPresentation (attract-mode hysteresis)", () => {
  it("backgrounds only once visibility drops below the low threshold", () => {
    expect(nextPresentation("foreground", 1)).toBe("foreground");
    expect(nextPresentation("foreground", BACKGROUND_BELOW)).toBe("foreground");
    expect(nextPresentation("foreground", BACKGROUND_BELOW - 0.01)).toBe("background");
    expect(nextPresentation("foreground", 0)).toBe("background");
  });

  it("reattaches only once visibility reaches the high threshold", () => {
    expect(nextPresentation("background", 0)).toBe("background");
    expect(nextPresentation("background", FOREGROUND_ABOVE - 0.01)).toBe("background");
    expect(nextPresentation("background", FOREGROUND_ABOVE)).toBe("foreground");
    expect(nextPresentation("background", 1)).toBe("foreground");
  });

  it("never flaps in the dead zone between the thresholds", () => {
    const mid = (BACKGROUND_BELOW + FOREGROUND_ABOVE) / 2;
    expect(nextPresentation("foreground", mid)).toBe("foreground");
    expect(nextPresentation("background", mid)).toBe("background");
  });
});
