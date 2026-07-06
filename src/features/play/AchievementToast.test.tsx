// Render test for AchievementToast (v0.37 W372,
// retroachievements-design.md §Unlock UX + persistence). Mirrors
// src/components/ErrorBoundary.test.tsx's harness: a plain
// createRoot mount + act(), no testing-library dependency.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AchievementToast } from "./AchievementToast";
import type { UnlockToast } from "../../ipc/retroachievements";

function sampleToast(overrides: Partial<UnlockToast> = {}): UnlockToast {
  return {
    achievementId: 42,
    title: "Speed Runner",
    description: "Finish World 1 in under 90 seconds.",
    points: 25,
    badgeName: null,
    ...overrides,
  };
}

describe("AchievementToast", () => {
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

  it("renders nothing when toast is null", () => {
    act(() => {
      root.render(<AchievementToast toast={null} />);
    });
    expect(container.textContent).toBe("");
  });

  it("renders the title, description, and points for a toast", () => {
    act(() => {
      root.render(<AchievementToast toast={sampleToast()} />);
    });
    expect(container.textContent).toContain("Speed Runner");
    expect(container.textContent).toContain("Finish World 1 in under 90 seconds.");
    expect(container.textContent).toContain("25 pts");
  });

  it("omits the points badge when points is zero", () => {
    act(() => {
      root.render(<AchievementToast toast={sampleToast({ points: 0 })} />);
    });
    expect(container.textContent).not.toContain("pts");
  });

  it("renders as a non-intrusive live region, never a dialog", () => {
    act(() => {
      root.render(<AchievementToast toast={sampleToast()} />);
    });
    const el = container.querySelector(".rgp-achievement-toast");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("role")).toBe("status");
    expect(el?.getAttribute("aria-live")).toBe("polite");
    // Never captures input: no focusable/interactive elements inside.
    expect(container.querySelectorAll("button, input, a, [tabindex]").length).toBe(0);
  });
});
