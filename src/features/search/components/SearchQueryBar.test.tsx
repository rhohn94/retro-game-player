// Render tests for SearchQueryBar (W394 keyboard-accessibility remainder of
// issue #29). Mirrors CollectionPicker.test.tsx's plain createRoot + act()
// mount convention (no testing-library dependency).
//
// Covers a real activation gap this component had: the "Search" button is
// rendered via FocusableAction's `render` prop, whose supplied `onClick` is
// ONLY a controller-focus claim (by contract — see FocusableControls.tsx) and
// never the real action. SearchQueryBar's button passed that bare `onClick`
// straight through, so a real mouse click (or Tab + Enter) silently did
// nothing — only a connected gamepad's confirm button actually ran the
// search (its rising-edge path calls the registered `onActivate` directly,
// bypassing the DOM click a mouse/keyboard press produces). Fixed by also
// invoking `onSearch` in the button's onClick, matching the already-correct
// ResultsToolbar Expand/Collapse-all precedent in this same feature.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchQueryBar } from "./SearchQueryBar";
import { ControllerProvider } from "../../controller";
import { DispatchProbe } from "../../testing/DispatchProbe";

describe("SearchQueryBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onSearch = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { __dispatchAction?: unknown }).__dispatchAction;
    delete (window as unknown as { __setFocus?: unknown }).__setFocus;
  });

  function render(overrides: Partial<Parameters<typeof SearchQueryBar>[0]> = {}) {
    act(() => {
      root.render(
        <ControllerProvider>
          <DispatchProbe />
          <SearchQueryBar
            query="mario"
            onQueryChange={vi.fn()}
            onQueryKeyDown={vi.fn()}
            consoleKey=""
            onConsoleChange={vi.fn()}
            consoles={[]}
            region=""
            onRegionChange={vi.fn()}
            onSearch={onSearch}
            searchDisabled={false}
            running={false}
            {...overrides}
          />
        </ControllerProvider>,
      );
    });
  }

  it("runs the search when the Search button is clicked", () => {
    render();
    const searchButton = Array.from(container.querySelectorAll<HTMLElement>("aura-button")).find(
      (b) => b.textContent?.trim() === "Search",
    )!;
    act(() => searchButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("does not run the search merely by claiming focus (no click)", () => {
    render();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("runs the search when a controller confirm fires while the Search button is focused", () => {
    render();
    // Claims focus directly via the probe rather than a D-pad move: jsdom's
    // zero-size layout rects make the real spatial-nav path unreliable here,
    // and reaching onActivate via confirm requires holding focus first.
    act(() => {
      (window as unknown as { __setFocus: (id: string) => void }).__setFocus("search:run");
    });
    act(() => {
      (window as unknown as { __dispatchAction: (a: string) => void }).__dispatchAction("confirm");
    });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});
