import { describe, expect, it } from "vitest";
import { sparklinePoints } from "./PerfSparkline";

describe("sparklinePoints", () => {
  it("returns an empty string when there is no finite data", () => {
    expect(sparklinePoints([], 100, 40, 3)).toBe("");
    expect(sparklinePoints([null, null], 100, 40, 3)).toBe("");
  });

  it("plots one point per finite value, skipping nulls", () => {
    const points = sparklinePoints([60, null, 30], 100, 40, 3);
    const pairs = points.split(" ");
    expect(pairs).toHaveLength(2);
  });

  it("a flat series (equal min/max) still yields well-formed, finite points", () => {
    const points = sparklinePoints([60, 60, 60], 100, 40, 3);
    const pairs = points.split(" ").map((p) => p.split(",").map(Number));
    expect(pairs).toHaveLength(3);
    for (const [x, y] of pairs) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("the highest value maps to the smallest y (near the top of the viewBox)", () => {
    const points = sparklinePoints([10, 60], 100, 40, 3);
    const [[, y0], [, y1]] = points.split(" ").map((p) => p.split(",").map(Number));
    expect(y1).toBeLessThan(y0); // 60 (index 1) is higher fps -> smaller y (SVG y grows downward)
  });

  it("a single value places its point at the left padding edge", () => {
    const points = sparklinePoints([42], 100, 40, 3);
    const [[x]] = points.split(" ").map((p) => p.split(",").map(Number));
    expect(x).toBeCloseTo(3, 5);
  });
});
