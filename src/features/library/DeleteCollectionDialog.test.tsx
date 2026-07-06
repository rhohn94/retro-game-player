// Render tests for DeleteCollectionDialog (v0.38 W385;
// docs/design/collections-design.md §Management UX). Mirrors
// CollectionPicker.test.tsx's plain createRoot + act() mount convention.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteCollectionDialog } from "./DeleteCollectionDialog";
import { ControllerProvider, useController } from "../controller";
import * as collectionsIpc from "../../ipc/collections";

vi.mock("../../ipc/collections", () => ({
  deleteCollection: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Exposes the controller's `dispatchAction` on `window` so tests can fire a
 * semantic action (simulating a controller Back press) without a real
 * gamepad poll. */
function DispatchProbe() {
  const { dispatchAction } = useController();
  (window as unknown as { __dispatchAction: typeof dispatchAction }).__dispatchAction =
    dispatchAction;
  return null;
}

describe("DeleteCollectionDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn>;
  let onDeleted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    onClose = vi.fn();
    onDeleted = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { __dispatchAction?: unknown }).__dispatchAction;
  });

  function render() {
    act(() => {
      root.render(
        <ControllerProvider>
          <DispatchProbe />
          <DeleteCollectionDialog
            open
            collectionId={7}
            collectionName="Kids"
            onClose={onClose}
            onDeleted={onDeleted}
          />
        </ControllerProvider>,
      );
    });
  }

  it("states plainly that games are not deleted", () => {
    render();
    expect(container.textContent).toContain("not deleted");
  });

  it("deletes the collection and calls onDeleted + onClose on confirm", async () => {
    vi.mocked(collectionsIpc.deleteCollection).mockResolvedValue(undefined);
    render();
    const confirmButton = Array.from(
      container.querySelectorAll<HTMLElement>("aura-button"),
    ).find((b) => b.textContent?.includes("Delete collection"))!;
    act(() => confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    expect(collectionsIpc.deleteCollection).toHaveBeenCalledWith(7);
    expect(onDeleted).toHaveBeenCalledWith(7);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error and does not close when delete fails", async () => {
    vi.mocked(collectionsIpc.deleteCollection).mockRejectedValue(new Error("db locked"));
    render();
    const confirmButton = Array.from(
      container.querySelectorAll<HTMLElement>("aura-button"),
    ).find((b) => b.textContent?.includes("Delete collection"))!;
    act(() => confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    expect(container.textContent).toContain("db locked");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancel button calls onClose without deleting", () => {
    render();
    const cancelButton = Array.from(
      container.querySelectorAll<HTMLElement>("aura-button"),
    ).find((b) => b.textContent === "Cancel")!;
    act(() => cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).toHaveBeenCalled();
    expect(collectionsIpc.deleteCollection).not.toHaveBeenCalled();
  });

  it("claims the exclusive 'ui' controller slot so a Back action closes the dialog", () => {
    render();
    act(() => {
      (window as unknown as { __dispatchAction: (a: string) => void }).__dispatchAction("back");
    });
    expect(onClose).toHaveBeenCalled();
  });
});
