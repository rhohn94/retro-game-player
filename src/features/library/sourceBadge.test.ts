// Unit tests for the non-retro source badge + launch-affordance helpers
// (v0.31 W315).

import { describe, it, expect } from "vitest";
import { isNonRetro, launchesViaLabel, sourceBadgeLabel } from "./sourceBadge";
import type { GameSource } from "../../ipc/library";

describe("isNonRetro", () => {
  it("is false for rom rows", () => {
    expect(isNonRetro({ source: "rom" })).toBe(false);
  });

  it("is true for every non-rom source", () => {
    const sources: GameSource[] = ["steam", "app", "manual"];
    for (const source of sources) {
      expect(isNonRetro({ source })).toBe(true);
    }
  });
});

describe("sourceBadgeLabel", () => {
  it("maps every GameSource to a human-readable badge label", () => {
    expect(sourceBadgeLabel("rom")).toBe("ROM");
    expect(sourceBadgeLabel("steam")).toBe("Steam");
    expect(sourceBadgeLabel("app")).toBe("App");
    expect(sourceBadgeLabel("manual")).toBe("Manual");
  });
});

describe("launchesViaLabel", () => {
  it("attributes Steam rows to Steam", () => {
    expect(launchesViaLabel("steam")).toBe("Launches via Steam");
  });

  it("attributes app and manual rows to macOS", () => {
    expect(launchesViaLabel("app")).toBe("Launches via macOS");
    expect(launchesViaLabel("manual")).toBe("Launches via macOS");
  });

  it("attributes rom rows to RetroArch", () => {
    expect(launchesViaLabel("rom")).toBe("Launches via RetroArch");
  });
});
