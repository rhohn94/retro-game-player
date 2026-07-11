// Render test for the Aura React wrapper's `className`-over-`class`
// precedence (W406, design-language.md §7.2). The wrapper factory
// (vendor/aura/bindings/react/aura-react.js, `createAuraComponent`, ~lines
// 267-273) resolves `classValue = className ?? class` and spreads it as the
// single `class` attribute; an explicit `className` is meant to win outright
// (not merge) when both are set. That claim was read correctly from source
// but never exercised by any call site or test — this closes that gap.
// Follows the ErrorBoundary.test.tsx template: jsdom via vitest.config.ts's
// `environmentMatchGlobs`, plain `react-dom/client` mount + act(), no
// testing-library dependency.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuraButton } from "@aura/react";

// Mirrors TvRail.test.tsx / useKeyboardNav.test.tsx: silences React's
// "not configured to support act(...)" warning under the bare
// createRoot + act() harness (no testing-library dependency).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Aura React wrapper className/class precedence", () => {
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

  it("uses className outright when both class and className are set", () => {
    act(() => {
      root.render(<AuraButton class="from-class" className="from-classname" />);
    });

    const el = container.querySelector("aura-button");
    expect(el).not.toBeNull();
    // className wins over class outright — not merged. If it were merged
    // (e.g. "from-class from-classname") this exact-equality check would fail.
    expect(el?.getAttribute("class")).toBe("from-classname");
    expect(el?.className).toBe("from-classname");
  });

  it("falls back to class when className is not set", () => {
    act(() => {
      root.render(<AuraButton class="from-class" />);
    });

    const el = container.querySelector("aura-button");
    expect(el?.getAttribute("class")).toBe("from-class");
  });

  it("uses className when class is not set", () => {
    act(() => {
      root.render(<AuraButton className="from-classname" />);
    });

    const el = container.querySelector("aura-button");
    expect(el?.getAttribute("class")).toBe("from-classname");
  });
});
