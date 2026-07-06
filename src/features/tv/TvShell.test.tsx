// First render tests for TvShell (v0.38 W383 — release-planning-v0.38.md
// §W383 (3): "the assertion W377's acceptance wanted"). W377 (user directive)
// removed the "Retro Game Player" label + scrim from the shell's top-chrome
// column, leaving only the Menu/Exit buttons; this is the first automated
// proof that label is gone and the two pointer chrome buttons are present —
// previously only asserted by eye. Mirrors
// `src/features/settings/panes/RetroAchievementsPane.test.tsx`'s bare
// createRoot + act() harness (no testing-library dependency).
//
// `useTvMode` is mocked directly rather than mounted under a real
// `TvModeProvider` (which needs a router + `useFullscreen`) — this test is
// about the shell's own chrome, not the mode-transition plumbing that already
// has its own coverage.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openMenu = vi.fn();

vi.mock("./TvModeContext", () => ({
  useTvMode: () => ({
    active: true,
    menuOpen: false,
    openMenu,
  }),
}));

// TvSystemMenu never mounts while menuOpen is false (above), but stub it
// anyway so this test never depends on its own (heavier) dependency chain.
vi.mock("./TvSystemMenu", () => ({
  TvSystemMenu: () => null,
}));

const { TvShell } = await import("./TvShell");

describe("TvShell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    openMenu.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders without the removed 'Retro Game Player' label, with Menu/Exit chrome present", async () => {
    await act(async () => {
      root.render(<TvShell onExit={() => undefined}>{<div>home content</div>}</TvShell>);
      await Promise.resolve();
    });

    // W377: the top-chrome column used to also show a "Retro Game Player"
    // label + scrim wash — both are gone now. A regression that brought the
    // label text back would fail this line.
    expect(container.textContent).not.toContain("Retro Game Player");

    const menuButton = container.querySelector('[aria-label="Open TV menu"]');
    const exitButton = container.querySelector('[aria-label="Exit TV mode"]');
    expect(menuButton).not.toBeNull();
    expect(exitButton).not.toBeNull();
    expect(menuButton?.textContent).toContain("Menu");
    expect(exitButton?.textContent).toContain("Exit");
  });

  it("renders the given children into the outlet", async () => {
    await act(async () => {
      root.render(<TvShell onExit={() => undefined}>{<div>home content</div>}</TvShell>);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("home content");
  });

  it("calls onExit when the exit button is clicked", async () => {
    const onExit = vi.fn();
    await act(async () => {
      root.render(<TvShell onExit={onExit} />);
      await Promise.resolve();
    });

    const exitButton = container.querySelector('[aria-label="Exit TV mode"]') as HTMLButtonElement;
    act(() => exitButton.click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
