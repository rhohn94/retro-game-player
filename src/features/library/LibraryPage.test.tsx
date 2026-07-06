// Render tests for LibraryPage's empty-collection state (v0.38 W385;
// docs/design/collections-design.md §Management UX). Mirrors
// CollectionPicker.test.tsx's plain createRoot + act() mount convention (no
// testing-library dependency); MemoryRouter wraps the page since it calls
// useNavigate.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPage } from "./LibraryPage";
import { ControllerProvider } from "../controller";
import * as libraryIpc from "../../ipc/commands";
import * as collectionsIpc from "../../ipc/collections";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.reject(new Error("not in a Tauri webview")),
  }),
}));

vi.mock("../../ipc/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/commands")>();
  return {
    ...actual,
    listGames: vi.fn(),
    getCachedArt: vi.fn(),
    fetchBoxart: vi.fn(),
    launchGame: vi.fn(),
  };
});

vi.mock("../../ipc/collections", () => ({
  listCollections: vi.fn(),
  listGamesByCollection: vi.fn(),
}));

function game(id: number, cleanName: string) {
  return {
    id,
    cleanName,
    system: "nes",
    artPath: null,
  } as unknown as import("../../ipc/commands").Game;
}

/** Flush the microtask queue so mocked-promise `.then` chains settle inside `act`. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("LibraryPage collection filter", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    vi.mocked(libraryIpc.getCachedArt).mockResolvedValue(null);
    vi.mocked(libraryIpc.fetchBoxart).mockResolvedValue("");
    vi.mocked(libraryIpc.listGames).mockResolvedValue([game(1, "Super Game")]);
    vi.mocked(collectionsIpc.listCollections).mockResolvedValue([
      { id: 1, name: "Kids", createdAt: 0, sort: 0, gameCount: 0 },
    ]);
    vi.mocked(collectionsIpc.listGamesByCollection).mockResolvedValue([]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows an explicit empty-collection message when the selected collection has zero members", async () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <ControllerProvider>
            <LibraryPage />
          </ControllerProvider>
        </MemoryRouter>,
      );
    });
    await flush();

    // Select the "Kids" collection via LibraryFilters' select control.
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by collection"]');
    expect(select).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )!.set!;
      setter.call(select, "1");
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("This collection is empty.");
    expect(container.textContent).not.toContain("No games match your filters.");
  });
});
