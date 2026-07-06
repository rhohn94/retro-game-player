import { describe, expect, it } from "vitest";
import { DrawCostSampler } from "./drawCostSampler";

describe("DrawCostSampler", () => {
  it("reports null before any sample is recorded", () => {
    const sampler = new DrawCostSampler();
    expect(sampler.meanMs).toBeNull();
    expect(sampler.sampleCount).toBe(0);
  });

  it("reports the exact value after a single sample", () => {
    const sampler = new DrawCostSampler();
    sampler.record(2.5);
    expect(sampler.meanMs).toBe(2.5);
    expect(sampler.sampleCount).toBe(1);
  });

  it("computes a rolling mean over multiple samples", () => {
    const sampler = new DrawCostSampler();
    sampler.record(1);
    sampler.record(2);
    sampler.record(3);
    expect(sampler.meanMs).toBeCloseTo(2);
  });

  it("drops the oldest sample once the window is full", () => {
    const sampler = new DrawCostSampler();
    // Fill the window with 30 samples of 1ms, then push a single 31st sample
    // of 100ms — if the oldest sample weren't dropped, the mean would barely
    // move; since it IS dropped, one 1ms sample leaves and one 100ms sample
    // enters, so the mean should shift measurably.
    for (let i = 0; i < 30; i++) sampler.record(1);
    expect(sampler.sampleCount).toBe(30);
    const before = sampler.meanMs;
    sampler.record(100);
    expect(sampler.sampleCount).toBe(30); // window size unchanged — oldest was evicted
    expect(sampler.meanMs).toBeGreaterThan(before!);
    expect(sampler.meanMs).toBeCloseTo(1 + 99 / 30);
  });

  it("ignores non-finite or negative samples", () => {
    const sampler = new DrawCostSampler();
    sampler.record(5);
    sampler.record(Number.NaN);
    sampler.record(Number.POSITIVE_INFINITY);
    sampler.record(-1);
    expect(sampler.meanMs).toBe(5);
    expect(sampler.sampleCount).toBe(1);
  });

  it("reset() clears back to the initial no-samples state", () => {
    const sampler = new DrawCostSampler();
    sampler.record(10);
    sampler.record(20);
    sampler.reset();
    expect(sampler.meanMs).toBeNull();
    expect(sampler.sampleCount).toBe(0);
  });
});
