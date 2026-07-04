import { describe, expect, it } from "vitest";
import { FpsCounter } from "./fpsCounter";

describe("FpsCounter", () => {
  it("reports 0 before the first window closes", () => {
    const counter = new FpsCounter();
    counter.tick(0);
    expect(counter.fps).toBe(0);
  });

  it("computes fps once the update interval elapses", () => {
    const counter = new FpsCounter();
    counter.tick(0); // opens the window
    // 30 ticks over 500ms => 60fps (30 frames / 0.5s)
    for (let i = 1; i <= 30; i++) {
      counter.tick(i * (500 / 30));
    }
    expect(counter.fps).toBeCloseTo(60, 0);
  });

  it("does not recompute before the interval elapses", () => {
    const counter = new FpsCounter();
    counter.tick(0);
    counter.tick(100);
    counter.tick(200);
    expect(counter.fps).toBe(0); // still mid-window
  });

  it("starts a fresh window after each recompute", () => {
    const counter = new FpsCounter();
    counter.tick(0);
    for (let i = 1; i <= 30; i++) counter.tick(i * (500 / 30)); // -> ~60fps
    const afterFirstWindow = counter.fps;
    expect(afterFirstWindow).toBeCloseTo(60, 0);
    // A slower second window: 15 frames over slightly more than 500ms => a
    // markedly lower fps than the first window — proves the window reset
    // (not a running average carried over from the first 60fps window).
    // (+10ms overshoot on the last tick guarantees this window actually closes
    // — landing exactly on the 500ms boundary can undershoot by float epsilon.)
    for (let i = 1; i <= 15; i++) counter.tick(500 + i * (510 / 15));
    expect(counter.fps).toBeLessThan(afterFirstWindow / 1.5);
    expect(counter.fps).toBeGreaterThan(20);
  });

  it("reset returns to the initial no-estimate state", () => {
    const counter = new FpsCounter();
    counter.tick(0);
    for (let i = 1; i <= 30; i++) counter.tick(i * (500 / 30));
    expect(counter.fps).toBeGreaterThan(0);
    counter.reset();
    expect(counter.fps).toBe(0);
    counter.tick(1000);
    expect(counter.fps).toBe(0); // the reset window hasn't closed yet
  });
});
