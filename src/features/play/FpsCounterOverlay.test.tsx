// Render test for FpsCounterOverlay (v0.38 W381: added the optional
// draw-cost line). Mirrors AchievementToast.test.tsx's harness: a plain
// createRoot mount + act(), no testing-library dependency.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FpsCounterOverlay } from "./FpsCounterOverlay";

describe("FpsCounterOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders nothing when disabled", () => {
    act(() => {
      root.render(<FpsCounterOverlay enabled={false} fps={60} drawCostMs={2} />);
    });
    expect(container.textContent).toBe("");
  });

  it("shows a placeholder dash before the first fps window closes", () => {
    act(() => {
      root.render(<FpsCounterOverlay enabled fps={0} />);
    });
    expect(container.textContent).toContain("— FPS");
  });

  it("shows the rounded fps once available", () => {
    act(() => {
      root.render(<FpsCounterOverlay enabled fps={59.6} />);
    });
    expect(container.textContent).toContain("60 FPS");
  });

  it("omits the draw-cost line when drawCostMs is null or undefined", () => {
    act(() => {
      root.render(<FpsCounterOverlay enabled fps={60} drawCostMs={null} />);
    });
    expect(container.textContent).toContain("60 FPS");
    expect(container.textContent).not.toContain("ms draw");
  });

  it("shows the draw-cost line when a real measurement is available", () => {
    act(() => {
      root.render(<FpsCounterOverlay enabled fps={60} drawCostMs={1.234} />);
    });
    expect(container.textContent).toContain("1.23 ms draw");
  });
});
