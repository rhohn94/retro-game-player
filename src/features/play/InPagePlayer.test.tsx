// First mount test for InPagePlayer, scoped to `presentation="preview"`
// (v0.38 W383 — release-planning-v0.38.md §W383 (3)): the W273/W376 purity
// contract says a preview session must never issue a library-life
// play-session record. `usePlaySession` (playSession.ts) is the REAL,
// un-mocked gate — asserted directly here (no `recordPlayStart` IPC call),
// mirroring NativePlayer.test.tsx's assertion on the same shared hook rather
// than re-deriving the gating logic.
//
// Largest mountable slice, not a full behavioral suite: this player's real
// gameplay runs inside an EmulatorJS iframe this test never loads (jsdom has
// no such runtime) — every native-play/controller/perf-tools IPC module is
// mocked at the module boundary the component itself already treats as a
// seam. Stubbed/not exercised here (follow-up, not faked): the postMessage
// bridge to the iframe (save/load round-trips, perf-stat reporting) and the
// overlay's full keyboard flow — both covered elsewhere
// (useOverlayMenu/useExclusiveControllerScope's own unit tests) or out of
// scope for a component-level smoke mount.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPlayOrigin = vi.fn();
vi.mock("../../ipc/play", () => ({
  getPlayOrigin: (...args: unknown[]) => getPlayOrigin(...args),
}));

const listGameSaves = vi.fn();
vi.mock("../../ipc/native-play", () => ({
  listGameSaves: (...args: unknown[]) => listGameSaves(...args),
}));

const recordPlayStart = vi.fn();
const recordPlayEnd = vi.fn();
vi.mock("../../ipc/play-stats", () => ({
  recordPlayStart: (...args: unknown[]) => recordPlayStart(...args),
  recordPlayEnd: (...args: unknown[]) => recordPlayEnd(...args),
}));

const getCrtFilter = vi.fn();
const setCrtFilter = vi.fn();
vi.mock("../../ipc/crt-filter", () => ({
  getCrtFilter: (...args: unknown[]) => getCrtFilter(...args),
  setCrtFilter: (...args: unknown[]) => setCrtFilter(...args),
}));

const reportEjsPerfStats = vi.fn();
const getShowFpsCounter = vi.fn();
const setShowFpsCounter = vi.fn();
vi.mock("../../ipc/perf-tools", () => ({
  reportEjsPerfStats: (...args: unknown[]) => reportEjsPerfStats(...args),
  getShowFpsCounter: (...args: unknown[]) => getShowFpsCounter(...args),
  setShowFpsCounter: (...args: unknown[]) => setShowFpsCounter(...args),
}));

const getPlayerPrefs = vi.fn();
const setPlayerPrefs = vi.fn();
vi.mock("../../ipc/player-prefs", () => ({
  getPlayerPrefs: (...args: unknown[]) => getPlayerPrefs(...args),
  setPlayerPrefs: (...args: unknown[]) => setPlayerPrefs(...args),
}));

const claimExclusive = vi.fn(() => () => undefined);
vi.mock("../controller", () => ({
  useController: () => ({ claimExclusive, bindingOverrides: [] }),
  useFocusable: () => ({ ref: { current: null }, isFocused: false, focus: vi.fn() }),
}));

const { InPagePlayer } = await import("./InPagePlayer");

describe("InPagePlayer (presentation='preview')", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    getPlayOrigin.mockResolvedValue("http://127.0.0.1:4173");
    listGameSaves.mockResolvedValue({ native: [], ejs: [] });
    recordPlayStart.mockResolvedValue(1);
    recordPlayEnd.mockResolvedValue(undefined);
    reportEjsPerfStats.mockResolvedValue(undefined);
    getCrtFilter.mockResolvedValue({});
    setCrtFilter.mockResolvedValue(undefined);
    getShowFpsCounter.mockResolvedValue(false);
    setShowFpsCounter.mockResolvedValue(undefined);
    getPlayerPrefs.mockResolvedValue({ volume: 1, pauseOnBlur: true });
    setPlayerPrefs.mockResolvedValue(undefined);
    claimExclusive.mockReturnValue(() => undefined);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("mounts a bare, save-less preview iframe without recording a play session", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <InPagePlayer gameId={9} ejsSystem="nes" gameName="Preview Game" presentation="preview" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // The W273/W376 purity assertion at component level: the real
    // `usePlaySession` gate must never call `recordPlayStart` for a preview
    // mount.
    expect(recordPlayStart).not.toHaveBeenCalled();

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toContain("preview=1");
    // A preview renders no chip bar / overlay chrome.
    expect(container.querySelector(".rgp-player__bar")).toBeNull();
  });

  it("records a play session for a non-preview (foreground) presentation", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <InPagePlayer gameId={9} ejsSystem="nes" gameName="Real Game" presentation="foreground" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(recordPlayStart).toHaveBeenCalledWith(9);
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).not.toContain("preview=1");
  });
});
