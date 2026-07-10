// Render tests for ProviderCatalog (v0.20 "Atlas"; W394 keyboard-accessibility
// remainder of issue #29). Mirrors DeleteCollectionDialog.test.tsx's plain
// createRoot + act() mount convention (no testing-library dependency) and its
// `DispatchProbe` pattern for exercising the controller's exclusive-claim
// Back handling without a real gamepad poll.
//
// Added alongside the fix for a real gap this dialog had: unlike its sibling
// ProviderDialog (add/edit provider), ProviderCatalog had NO Escape handling
// at all, so pressing Escape while it was open fell through to the app
// shell's default `back` handler (`navigate(-1)`) instead of closing it.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderCatalog } from "./ProviderCatalog";
import { ControllerProvider, useController } from "../controller";
import * as searchIpc from "../../ipc/search";
import type { CatalogProvider } from "../../ipc/search";

vi.mock("../../ipc/search", () => ({
  listProviderCatalog: vi.fn(),
  addProvider: vi.fn(),
}));

/** Flush the microtask queue so mocked-promise `.then` chains settle inside `act`. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Exposes the controller's `dispatchAction` on `window` so tests can fire a
 * semantic action (simulating a controller Back press) without a real
 * gamepad poll — mirrors DeleteCollectionDialog.test.tsx's probe. */
function DispatchProbe() {
  const { dispatchAction } = useController();
  (window as unknown as { __dispatchAction: typeof dispatchAction }).__dispatchAction =
    dispatchAction;
  return null;
}

const CATALOG: CatalogProvider[] = [
  {
    name: "Example Archive",
    urlTemplate: "https://example.org/search?q={query}",
    kind: "download",
    media: "Indie & homebrew",
    description: "A preservation archive.",
    jsRendered: false,
    added: false,
  },
];

describe("ProviderCatalog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn>;
  let onAdded: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    onClose = vi.fn();
    onAdded = vi.fn();
    vi.mocked(searchIpc.listProviderCatalog).mockResolvedValue(CATALOG);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { __dispatchAction?: unknown }).__dispatchAction;
  });

  async function render() {
    act(() => {
      root.render(
        <ControllerProvider>
          <DispatchProbe />
          <ProviderCatalog open onClose={onClose} onAdded={onAdded} />
        </ControllerProvider>,
      );
    });
    await flush();
  }

  it("lists the curated catalog entries", async () => {
    await render();
    expect(container.textContent).toContain("Example Archive");
  });

  it("carries list semantics on the catalog entries", async () => {
    await render();
    const list = container.querySelector("ul")!;
    expect(list.getAttribute("role")).toBe("list");
  });

  it("closes via the × close button", async () => {
    await render();
    const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    act(() => closeButton.click());
    expect(onClose).toHaveBeenCalled();
  });

  it("claims the exclusive 'ui' controller slot so a Back action closes the dialog", async () => {
    await render();
    act(() => {
      (window as unknown as { __dispatchAction: (a: string) => void }).__dispatchAction("back");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on a direct Escape keydown", async () => {
    await render();
    // Dispatch on a real descendant of the dialog body (the onKeyDown handler
    // sits on the inner motion.div, which is a CHILD of `.rgp-provider-catalog`
    // — events bubble up from the target, not down from an ancestor).
    const filterInput = container.querySelector<HTMLElement>('input[name="catalog-filter"]')!;
    act(() => {
      filterInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a catalog entry and reports it via onAdded", async () => {
    const created = {
      id: 9,
      name: "Example Archive",
      urlTemplate: "https://example.org/search?q={query}",
      enabled: true,
      kind: "download",
      directDownload: false,
      composeFilters: false,
    };
    vi.mocked(searchIpc.addProvider).mockResolvedValue(created);
    await render();

    const addButton = Array.from(container.querySelectorAll<HTMLElement>("aura-button")).find((b) =>
      b.textContent?.includes("Add"),
    )!;
    act(() => addButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    expect(searchIpc.addProvider).toHaveBeenCalledWith({
      name: "Example Archive",
      urlTemplate: "https://example.org/search?q={query}",
      kind: "download",
    });
    expect(onAdded).toHaveBeenCalledWith(created);
  });
});
