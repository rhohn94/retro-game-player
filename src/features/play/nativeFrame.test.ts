import { describe, expect, it } from "vitest";
import { decodeRgba, isWellFormedRgba } from "./nativeFrame";

describe("decodeRgba", () => {
  it("round-trips a known RGBA pixel", () => {
    const bytes = Uint8Array.from([255, 0, 0, 255]);
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(decodeRgba(base64))).toEqual([255, 0, 0, 255]);
  });

  it("decodes an empty payload to an empty array", () => {
    expect(decodeRgba("").length).toBe(0);
  });
});

describe("isWellFormedRgba", () => {
  it("accepts bytes matching width * height * 4 exactly", () => {
    const bytes = new Uint8ClampedArray(2 * 2 * 4);
    expect(isWellFormedRgba({ width: 2, height: 2 }, bytes)).toBe(true);
  });

  it("rejects a short/truncated payload", () => {
    const bytes = new Uint8ClampedArray(2 * 2 * 4 - 1);
    expect(isWellFormedRgba({ width: 2, height: 2 }, bytes)).toBe(false);
  });

  it("rejects an over-long payload", () => {
    const bytes = new Uint8ClampedArray(2 * 2 * 4 + 4);
    expect(isWellFormedRgba({ width: 2, height: 2 }, bytes)).toBe(false);
  });
});
