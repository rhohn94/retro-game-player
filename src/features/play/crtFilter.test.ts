import { describe, expect, it } from "vitest";
import {
  CRT_FILTER_OFF,
  CRT_PRESETS,
  CRT_PRESET_LIST,
  applyCrtPreset,
  clampCrtFilter,
  clampIntensity,
  isCrtFilterOff,
  matchingPreset,
  toUnit,
} from "./crtFilter";
import type { CrtFilterConfig } from "../../ipc/crt-filter";

describe("clampIntensity", () => {
  it("clamps into [0, 100]", () => {
    expect(clampIntensity(50)).toBe(50);
    expect(clampIntensity(-5)).toBe(0);
    expect(clampIntensity(500)).toBe(100);
  });

  it("rounds fractional input", () => {
    expect(clampIntensity(49.6)).toBe(50);
  });

  it("treats non-finite input as zero", () => {
    expect(clampIntensity(Number.NaN)).toBe(0);
    expect(clampIntensity(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("clampCrtFilter", () => {
  it("clamps every intensity field independently", () => {
    const out = clampCrtFilter({
      scanlines: -10,
      curvature: 200,
      colorBleed: 50,
      vignette: Number.NaN,
      preset: null,
    });
    expect(out).toEqual({ scanlines: 0, curvature: 100, colorBleed: 50, vignette: 0, preset: null });
  });

  it("passes the preset field through unchanged", () => {
    const out = clampCrtFilter({ ...CRT_PRESETS.classic });
    expect(out.preset).toBe("classic");
  });
});

describe("CRT_PRESETS / CRT_PRESET_LIST", () => {
  it("lists exactly the four named presets from the design doc", () => {
    expect(CRT_PRESET_LIST.map((p) => p.id)).toEqual(["off", "classic", "arcade", "sharp"]);
  });

  it("every preset intensity is already in range", () => {
    for (const preset of Object.values(CRT_PRESETS)) {
      for (const value of [preset.scanlines, preset.curvature, preset.colorBleed, preset.vignette]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it("off is the all-zero preset", () => {
    expect(CRT_PRESETS.off).toEqual(CRT_FILTER_OFF);
  });
});

describe("matchingPreset", () => {
  it("recognizes an exact preset match", () => {
    expect(matchingPreset(CRT_PRESETS.arcade)).toBe("arcade");
  });

  it("returns null for a free-tweaked mix that matches no preset", () => {
    const mix: CrtFilterConfig = { scanlines: 33, curvature: 12, colorBleed: 7, vignette: 1, preset: null };
    expect(matchingPreset(mix)).toBeNull();
  });

  it("ignores the config's own preset field, recomputing from intensities", () => {
    const mismatched: CrtFilterConfig = { ...CRT_PRESETS.sharp, preset: "classic" };
    expect(matchingPreset(mismatched)).toBe("sharp");
  });
});

describe("applyCrtPreset", () => {
  it("returns a fresh object, not a shared reference", () => {
    const a = applyCrtPreset("classic");
    const b = applyCrtPreset("classic");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("applying 'off' zeroes every effect", () => {
    expect(isCrtFilterOff(applyCrtPreset("off"))).toBe(true);
  });
});

describe("isCrtFilterOff", () => {
  it("is true only when every intensity is zero", () => {
    expect(isCrtFilterOff(CRT_FILTER_OFF)).toBe(true);
    expect(isCrtFilterOff({ ...CRT_FILTER_OFF, scanlines: 1 })).toBe(false);
  });
});

describe("toUnit", () => {
  it("normalizes 0-100 into 0-1", () => {
    expect(toUnit(0)).toBe(0);
    expect(toUnit(100)).toBe(1);
    expect(toUnit(50)).toBe(0.5);
  });

  it("clamps out-of-range input before normalizing", () => {
    expect(toUnit(-20)).toBe(0);
    expect(toUnit(250)).toBe(1);
  });
});
