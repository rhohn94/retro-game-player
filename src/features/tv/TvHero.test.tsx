// First render tests for TvHero (v0.38 W383 — release-planning-v0.38.md
// §W383 (3): "the assertion W377's acceptance wanted"). W377 (user directive)
// removed the hero's gradient scrim/"Retro Game Player" framing so the title
// reads directly over the art; this proves that label never appears here
// either, alongside the play affordance chrome. Mirrors
// `src/features/settings/panes/RetroAchievementsPane.test.tsx`'s bare
// createRoot + act() harness (no testing-library dependency).
//
// `useFocusable` (controller feature) and `useGameArt` (ipc/metadata-backed)
// are mocked directly — this test is about the hero's own render output, not
// the controller-registration or art-resolution plumbing, which each have
// their own coverage.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../ipc/library";

const focus = vi.fn();
const useFocusable = vi.fn(() => ({
  ref: { current: null },
  isFocused: false,
  focus,
}));

vi.mock("../controller", () => ({
  useFocusable: (...args: unknown[]) => useFocusable(...(args as [])),
}));

const getCachedArtTiers = vi.fn();
const fetchGameArt = vi.fn();
vi.mock("../../ipc/metadata", () => ({
  getCachedArtTiers: (...args: unknown[]) => getCachedArtTiers(...args),
  fetchGameArt: (...args: unknown[]) => fetchGameArt(...args),
}));

const { TvHero } = await import("./TvHero");

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 1,
    path: "/roms/game.nes",
    system: "nes",
    crc32: null,
    md5: null,
    cleanName: "Test Game",
    datMatched: false,
    coreHint: null,
    artPath: null,
    sizeBytes: 0,
    addedAt: 0,
    year: 1991,
    developer: null,
    publisher: null,
    aliases: [],
    description: null,
    wikipediaUrl: null,
    favorite: false,
    lastPlayedAt: null,
    playCount: 0,
    totalPlayTimeMs: 0,
    source: "rom",
    launchDescriptor: null,
    externalId: null,
    ...overrides,
  };
}

describe("TvHero", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useFocusable.mockClear();
    focus.mockClear();
    getCachedArtTiers.mockReset().mockResolvedValue([]);
    fetchGameArt.mockReset().mockResolvedValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders the featured game's title and play chrome, with no 'Retro Game Player' label", async () => {
    const game = makeGame();
    await act(async () => {
      root.render(<TvHero game={game} onLaunch={() => undefined} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Test Game");
    // W377: no shell/hero surface shows the app-name label any more.
    expect(container.textContent).not.toContain("Retro Game Player");

    const playButton = container.querySelector('[aria-label="Play Test Game"]');
    expect(playButton).not.toBeNull();
    expect(playButton?.textContent).toContain("Play");
  });

  it("renders a disabled play affordance and no title when no game is focused", async () => {
    await act(async () => {
      root.render(<TvHero game={null} onLaunch={() => undefined} />);
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Retro Game Player");
    const playButton = container.querySelector('[aria-label="Play"]') as HTMLButtonElement;
    expect(playButton).not.toBeNull();
    expect(playButton.disabled).toBe(true);
  });

  it("calls onLaunch with the game when the play button is clicked", async () => {
    const game = makeGame();
    const onLaunch = vi.fn();
    await act(async () => {
      root.render(<TvHero game={game} onLaunch={onLaunch} />);
      await Promise.resolve();
    });

    const playButton = container.querySelector('[aria-label="Play Test Game"]') as HTMLButtonElement;
    act(() => playButton.click());
    expect(onLaunch).toHaveBeenCalledWith(game);
  });
});
