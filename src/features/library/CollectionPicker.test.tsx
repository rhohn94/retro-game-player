// Render tests for CollectionPicker (v0.37 W373): add, remove, inline-create.
// Runs under jsdom (see vitest.config.ts's environmentMatchGlobs) via a plain
// createRoot + act() mount, mirroring ErrorBoundary.test.tsx — no
// testing-library dependency. The `../../ipc/collections` module is mocked so
// no real Tauri invoke is needed.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionPicker } from "./CollectionPicker";
import { ControllerProvider } from "../controller";
import * as collectionsIpc from "../../ipc/collections";

vi.mock("../../ipc/collections", () => ({
  listCollections: vi.fn(),
  listCollectionIdsForGame: vi.fn(),
  addGameToCollection: vi.fn(),
  removeGameFromCollection: vi.fn(),
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
}));

/** Flush the microtask queue so mocked-promise `.then` chains settle inside `act`. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Set a controlled `<input>`'s value through React's tracked native setter
 * (a plain `input.value = ...` bypasses React's change detection, since React
 * patches the native value setter to notice writes — see the well-known
 * jsdom/React testing workaround) and dispatch the `input` event React
 * listens for. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CollectionPicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    vi.mocked(collectionsIpc.listCollections).mockResolvedValue([
      { id: 1, name: "RPGs", createdAt: 0, sort: 0, gameCount: 2 },
      { id: 2, name: "Kids", createdAt: 0, sort: 0, gameCount: 0 },
    ]);
    vi.mocked(collectionsIpc.listCollectionIdsForGame).mockResolvedValue([1]);
    vi.mocked(collectionsIpc.addGameToCollection).mockResolvedValue(undefined);
    vi.mocked(collectionsIpc.removeGameFromCollection).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function openPicker() {
    act(() => {
      root.render(
        <ControllerProvider>
          <CollectionPicker gameId={42} />
        </ControllerProvider>,
      );
    });
    const toggle = container.querySelector<HTMLButtonElement>(".rgp-collection-picker__toggle")!;
    act(() => toggle.click());
    await flush();
  }

  it("loads and lists every collection with its member checkbox state", async () => {
    await openPicker();
    const rows = container.querySelectorAll<HTMLInputElement>(".rgp-collection-picker__row input");
    expect(rows).toHaveLength(2);
    const rpgs = Array.from(rows).find((r) => r.closest(".rgp-collection-picker__row-label")?.textContent?.includes("RPGs"));
    const kids = Array.from(rows).find((r) => r.closest(".rgp-collection-picker__row-label")?.textContent?.includes("Kids"));
    expect(rpgs?.checked).toBe(true);
    expect(kids?.checked).toBe(false);
  });

  it("adds the game to a collection when its unchecked row is toggled", async () => {
    await openPicker();
    const rows = container.querySelectorAll<HTMLInputElement>(".rgp-collection-picker__row input");
    const kids = Array.from(rows).find((r) => r.closest(".rgp-collection-picker__row-label")?.textContent?.includes("Kids"))!;
    act(() => kids.click());
    await flush();
    expect(collectionsIpc.addGameToCollection).toHaveBeenCalledWith(2, 42);
    expect(kids.checked).toBe(true);
  });

  it("removes the game from a collection when its checked row is toggled", async () => {
    await openPicker();
    const rows = container.querySelectorAll<HTMLInputElement>(".rgp-collection-picker__row input");
    const rpgs = Array.from(rows).find((r) => r.closest(".rgp-collection-picker__row-label")?.textContent?.includes("RPGs"))!;
    act(() => rpgs.click());
    await flush();
    expect(collectionsIpc.removeGameFromCollection).toHaveBeenCalledWith(1, 42);
    expect(rpgs.checked).toBe(false);
  });

  it("reverts an optimistic toggle when the persist call fails", async () => {
    vi.mocked(collectionsIpc.addGameToCollection).mockRejectedValue(new Error("boom"));
    await openPicker();
    const rows = container.querySelectorAll<HTMLInputElement>(".rgp-collection-picker__row input");
    const kids = Array.from(rows).find((r) => r.closest(".rgp-collection-picker__row-label")?.textContent?.includes("Kids"))!;
    act(() => kids.click());
    await flush();
    expect(kids.checked).toBe(false);
  });

  it("creates a new collection inline and adds the game to it", async () => {
    vi.mocked(collectionsIpc.createCollection).mockResolvedValue({
      id: 3,
      name: "Couch co-op",
      createdAt: 0,
      sort: 0,
    });
    await openPicker();
    const input = container.querySelector<HTMLInputElement>(
      '.rgp-collection-picker__new input[type="text"]',
    )!;
    act(() => typeInto(input, "Couch co-op"));
    const addButton = container.querySelector(".rgp-collection-picker__new aura-button")!;
    act(() => addButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();
    expect(collectionsIpc.createCollection).toHaveBeenCalledWith("Couch co-op");
    expect(collectionsIpc.addGameToCollection).toHaveBeenCalledWith(3, 42);
    expect(container.textContent).toContain("Couch co-op");
  });

  it("disables the inline Add button for an empty or duplicate name", async () => {
    await openPicker();
    const addButton = container.querySelector(".rgp-collection-picker__new aura-button")!;
    expect(addButton.hasAttribute("disabled")).toBe(true);

    const input = container.querySelector<HTMLInputElement>(
      '.rgp-collection-picker__new input[type="text"]',
    )!;
    act(() => typeInto(input, "RPGs"));
    expect(addButton.hasAttribute("disabled")).toBe(true);
  });

  it("shows a loading state while the initial fetch is in flight", async () => {
    let resolveList!: (rows: collectionsIpc.CollectionWithCount[]) => void;
    vi.mocked(collectionsIpc.listCollections).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    act(() => {
      root.render(
        <ControllerProvider>
          <CollectionPicker gameId={42} />
        </ControllerProvider>,
      );
    });
    const toggle = container.querySelector<HTMLButtonElement>(".rgp-collection-picker__toggle")!;
    act(() => toggle.click());
    await flush();

    expect(container.textContent).toContain("Loading collections…");

    act(() => resolveList([]));
    await flush();
    expect(container.textContent).not.toContain("Loading collections…");
  });

  it("shows a visible error state when the fetch fails", async () => {
    vi.mocked(collectionsIpc.listCollections).mockRejectedValue(new Error("offline"));
    await openPicker();
    expect(container.textContent).toContain("Could not load collections");
    expect(container.textContent).toContain("offline");
  });

  it("renames a collection in place via the row's rename affordance", async () => {
    vi.mocked(collectionsIpc.renameCollection).mockResolvedValue(undefined);
    await openPicker();
    const renameButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Rename Kids"]',
    )!;
    act(() => renameButton.click());

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Rename Kids"]')!;
    act(() => typeInto(input, "Kids games"));
    const saveButton = Array.from(
      container.querySelectorAll<HTMLElement>(".rgp-collection-picker__row--renaming aura-button"),
    ).find((b) => b.textContent === "Save")!;
    act(() => saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    expect(collectionsIpc.renameCollection).toHaveBeenCalledWith(2, "Kids games");
    expect(container.textContent).toContain("Kids games");
  });

  it("rejects a whitespace-only rename client-side without calling the IPC", async () => {
    await openPicker();
    const renameButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Rename Kids"]',
    )!;
    act(() => renameButton.click());

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Rename Kids"]')!;
    act(() => typeInto(input, "   "));
    const saveButton = Array.from(
      container.querySelectorAll<HTMLElement>(".rgp-collection-picker__row--renaming aura-button"),
    ).find((b) => b.textContent === "Save")!;
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    expect(collectionsIpc.renameCollection).not.toHaveBeenCalled();
  });

  it("deletes a collection through the confirmation dialog", async () => {
    vi.mocked(collectionsIpc.deleteCollection).mockResolvedValue(undefined);
    await openPicker();
    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete Kids"]',
    )!;
    act(() => deleteButton.click());
    await flush();

    expect(container.textContent).toContain("Delete “Kids”?");
    expect(container.textContent).toContain("not deleted");

    const confirmButton = Array.from(
      container.querySelectorAll<HTMLElement>(".rgp-delete-collection-dialog aura-button"),
    ).find((b) => b.textContent?.includes("Delete collection"))!;
    act(() => confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    expect(collectionsIpc.deleteCollection).toHaveBeenCalledWith(2);
    expect(container.querySelector(".rgp-delete-collection-dialog")).toBeNull();
    expect(container.textContent).not.toContain("Kids");
  });

  it("cancelling the delete dialog leaves the collection untouched", async () => {
    await openPicker();
    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete Kids"]',
    )!;
    act(() => deleteButton.click());
    await flush();

    const cancelButton = Array.from(
      container.querySelectorAll<HTMLElement>(".rgp-delete-collection-dialog aura-button"),
    ).find((b) => b.textContent === "Cancel")!;
    act(() => cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    expect(collectionsIpc.deleteCollection).not.toHaveBeenCalled();
    expect(container.querySelector(".rgp-delete-collection-dialog")).toBeNull();
    expect(container.textContent).toContain("Kids");
  });
});
