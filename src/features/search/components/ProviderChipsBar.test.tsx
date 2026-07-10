// Render tests for ProviderChipsBar (W394 keyboard-accessibility remainder of
// issue #29). Mirrors CollectionPicker.test.tsx's plain createRoot + act()
// mount convention (no testing-library dependency).
//
// Covers a real activation gap this component had: "+ Add" and
// "⊞ Browse providers" are rendered via FocusableAction's `render` prop,
// whose supplied `onClick` is ONLY a controller-focus claim (by contract —
// see FocusableControls.tsx) and never the real action. Both buttons passed
// that bare `onClick` straight through, so a real mouse click (or Tab +
// Enter) silently did nothing — only a connected gamepad's confirm button
// actually opened the add/catalog dialog. Fixed by also invoking
// onAddProvider/onBrowse in each button's onClick, matching the
// already-correct ResultsToolbar Expand/Collapse-all precedent in this same
// feature.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderChipsBar } from "./ProviderChipsBar";
import { ControllerProvider } from "../../controller";
import type { SearchProvider } from "../../../ipc/search";

const PROVIDER: SearchProvider = {
  id: 1,
  name: "MobyGames",
  urlTemplate: "https://example.com?q={query}",
  enabled: true,
  kind: "reference",
  directDownload: false,
  composeFilters: false,
};

describe("ProviderChipsBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onAddProvider: ReturnType<typeof vi.fn>;
  let onBrowse: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onAddProvider = vi.fn();
    onBrowse = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => {
      root.render(
        <ControllerProvider>
          <ProviderChipsBar
            providers={[PROVIDER]}
            hasProviders
            onToggle={vi.fn()}
            onEdit={vi.fn()}
            onRemove={vi.fn()}
            onAddProvider={onAddProvider}
            onBrowse={onBrowse}
          />
        </ControllerProvider>,
      );
    });
  }

  function findButton(text: string): HTMLElement {
    return Array.from(container.querySelectorAll<HTMLElement>("aura-button")).find(
      (b) => b.textContent?.trim() === text,
    )!;
  }

  it("opens the add-provider dialog when + Add is clicked", () => {
    render();
    act(() => findButton("+ Add").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAddProvider).toHaveBeenCalledTimes(1);
  });

  it("opens the catalog when Browse providers is clicked", () => {
    render();
    act(() =>
      findButton("⊞ Browse providers").dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it("does not fire either action merely by rendering (no click)", () => {
    render();
    expect(onAddProvider).not.toHaveBeenCalled();
    expect(onBrowse).not.toHaveBeenCalled();
  });
});
