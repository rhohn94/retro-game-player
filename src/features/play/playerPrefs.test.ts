import { describe, expect, it } from "vitest";
import { clampVolume, toggledMuteVolume } from "./playerPrefs";

describe("clampVolume", () => {
  it("clamps into [0, 1]", () => {
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(3)).toBe(1);
  });

  it("treats non-finite input as full volume", () => {
    expect(clampVolume(Number.NaN)).toBe(1);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("toggledMuteVolume", () => {
  it("mutes when audible", () => {
    expect(toggledMuteVolume(0.8, 0.8)).toBe(0);
  });

  it("restores the last audible volume on unmute", () => {
    expect(toggledMuteVolume(0, 0.8)).toBe(0.8);
  });

  it("falls back to a sensible volume when nothing audible is known", () => {
    expect(toggledMuteVolume(0, 0)).toBe(0.5);
  });
});
