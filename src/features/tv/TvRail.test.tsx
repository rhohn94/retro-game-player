// Render tests for TvRail's list/aria treatment (issue #34 §4): the row must
// stay a coherent ARIA list — `role="list"` on the row, `role="listitem"` on
// every real tile, and `role="presentation"` + `aria-hidden` on the windowed-
// out spacers so they never read as stray list members. Mirrors
// `ErrorBoundary.test.tsx`'s bare createRoot + act() harness (no
// testing-library dependency).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../ipc/library";
import { ControllerProvider } from "../controller";
import { TvRail } from "./TvRail";
import { WINDOW_THRESHOLD, type TvRailModel } from "./rails";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ipc/metadata", () => ({
  getCachedArtTiers: vi.fn().mockResolvedValue([]),
  fetchGameArt: vi.fn().mockResolvedValue(null),
}));

/** Minimal Game factory — only the fields TvTile/TvRail read. */
function game(id: number): Game {
  return {
    id,
    path: `/roms/g${id}`,
    system: "nes",
    crc32: null,
    md5: null,
    cleanName: `Game ${id}`,
    datMatched: true,
    coreHint: null,
    artPath: null,
    sizeBytes: 0,
    addedAt: id,
    favorite: false,
    source: "rom",
  } as Game;
}

describe("TvRail aria/list treatment", () => {
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
    vi.restoreAllMocks();
  });

  async function renderRail(rail: TvRailModel) {
    await act(async () => {
      root.render(
        <ControllerProvider>
          <TvRail rail={rail} onLaunch={() => {}} />
        </ControllerProvider>,
      );
      // Let each TvTile's useGameArt (mocked, resolved) microtask settle
      // inside act() so its state update doesn't warn as unwrapped.
      await Promise.resolve();
    });
  }

  it("marks the row as a list and every tile as a listitem (short rail)", async () => {
    const rail: TvRailModel = { id: "rail:test", label: "Test", games: [game(1), game(2), game(3)] };
    await renderRail(rail);

    const row = container.querySelector('[data-rail-id="rail:test"]');
    expect(row?.getAttribute("role")).toBe("list");

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items.length).toBe(3);
  });

  it("keeps windowed-out spacers out of the list's accessible children", async () => {
    const games = Array.from({ length: WINDOW_THRESHOLD + 10 }, (_, i) => game(i));
    const rail: TvRailModel = { id: "rail:big", label: "Big", games };
    await renderRail(rail);

    const row = container.querySelector('[data-rail-id="rail:big"]');
    expect(row?.getAttribute("role")).toBe("list");

    const spacers = container.querySelectorAll(".rgp-tv-rail__spacer");
    expect(spacers.length).toBeGreaterThan(0);
    for (const spacer of spacers) {
      expect(spacer.getAttribute("role")).toBe("presentation");
      expect(spacer.hasAttribute("aria-hidden")).toBe(true);
    }

    // The windowed tile count must be strictly fewer than the full rail, and
    // none of the mounted tiles is itself hidden from assistive tech.
    const items = container.querySelectorAll('[role="listitem"]');
    expect(items.length).toBeLessThan(games.length);
    for (const item of items) {
      expect(item.hasAttribute("aria-hidden")).toBe(false);
    }
  });
});
