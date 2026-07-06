// First mount test for NativePlayer, scoped to `presentation="preview"`
// (v0.38 W383 — release-planning-v0.38.md §W383 (3)): the W273/W376 purity
// contract says a preview session must never issue a library-life
// play-session record. `usePlaySession` (playSession.ts) is the REAL,
// un-mocked gate — this test asserts on its actual output (no
// `recordPlayStart` IPC call) rather than re-deriving "preview ⇒ no record"
// itself, per the item's instructions.
//
// This is the largest mountable slice, not a full behavioral suite: jsdom has
// no WebGL2 (`getContext("webgl2")` returns null), no real gamepad API, and
// no native IPC transport, so every native-play/controller/achievement/
// perf/crt-filter IPC module is mocked at the module boundary — the seams
// this component itself already treats as boundaries. `crtWebglRenderer` is
// stubbed explicitly (rather than relying on jsdom's WebGL2-less
// `getContext` returning null) so this test doesn't depend on how W381's
// concurrent renderer-constructor edits shape that fallback.
//
// Stubbed/not exercised here (follow-up, not faked): the rAF frame-paint
// loop's actual pixel output, real gamepad input, and the overlay's full
// keyboard-navigation flow — all covered elsewhere (crtWebglRenderer.test.ts,
// nativeInput.test.ts, useExclusiveControllerScope's routeScopedAction unit
// tests) or out of scope for a component-level smoke mount.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startNativePlay = vi.fn();
const stopNativePlay = vi.fn();
const getNativeFrame = vi.fn();
const setNativeVolume = vi.fn();
const setNativePaused = vi.fn();
const setNativeInput = vi.fn();
const releaseAllNativeInput = vi.fn();
const listGameSaves = vi.fn();
const saveNativeState = vi.fn();
const loadNativeState = vi.fn();

vi.mock("../../ipc/native-play", () => ({
  startNativePlay: (...args: unknown[]) => startNativePlay(...args),
  stopNativePlay: (...args: unknown[]) => stopNativePlay(...args),
  getNativeFrame: (...args: unknown[]) => getNativeFrame(...args),
  setNativeVolume: (...args: unknown[]) => setNativeVolume(...args),
  setNativePaused: (...args: unknown[]) => setNativePaused(...args),
  setNativeInput: (...args: unknown[]) => setNativeInput(...args),
  releaseAllNativeInput: (...args: unknown[]) => releaseAllNativeInput(...args),
  listGameSaves: (...args: unknown[]) => listGameSaves(...args),
  saveNativeState: (...args: unknown[]) => saveNativeState(...args),
  loadNativeState: (...args: unknown[]) => loadNativeState(...args),
}));

const recordPlayStart = vi.fn();
const recordPlayEnd = vi.fn();
vi.mock("../../ipc/play-stats", () => ({
  recordPlayStart: (...args: unknown[]) => recordPlayStart(...args),
  recordPlayEnd: (...args: unknown[]) => recordPlayEnd(...args),
}));

const pollAchievementUnlocks = vi.fn();
vi.mock("../../ipc/retroachievements", () => ({
  pollAchievementUnlocks: (...args: unknown[]) => pollAchievementUnlocks(...args),
}));

const getCrtFilter = vi.fn();
const setCrtFilter = vi.fn();
vi.mock("../../ipc/crt-filter", () => ({
  getCrtFilter: (...args: unknown[]) => getCrtFilter(...args),
  setCrtFilter: (...args: unknown[]) => setCrtFilter(...args),
}));

const getShowFpsCounter = vi.fn();
const setShowFpsCounter = vi.fn();
vi.mock("../../ipc/perf-tools", () => ({
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

// W381 stub seam: this player's own construction attempt already degrades to
// plain 2D painting on a `null` webgl2 context (jsdom has none), but stub the
// module directly so a concurrent renderer-constructor signature change
// can't fail this mount test either way.
vi.mock("./crtWebglRenderer", () => ({
  CrtWebglRenderer: vi.fn().mockImplementation(() => {
    throw new Error("stubbed: no WebGL2 in this test environment");
  }),
  CrtWebglUnavailableError: class extends Error {},
}));

const { NativePlayer } = await import("./NativePlayer");

describe("NativePlayer (presentation='preview')", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    startNativePlay.mockResolvedValue(undefined);
    stopNativePlay.mockResolvedValue(undefined);
    getNativeFrame.mockResolvedValue(null);
    setNativeVolume.mockResolvedValue(undefined);
    setNativePaused.mockResolvedValue(undefined);
    setNativeInput.mockResolvedValue(undefined);
    releaseAllNativeInput.mockResolvedValue(undefined);
    listGameSaves.mockResolvedValue({ native: [], ejs: [] });
    recordPlayStart.mockResolvedValue(1);
    recordPlayEnd.mockResolvedValue(undefined);
    pollAchievementUnlocks.mockResolvedValue([]);
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

  it("mounts a bare canvas and starts a save-less native session, without recording a play session", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <NativePlayer gameId={7} gameName="Preview Game" presentation="preview" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startNativePlay).toHaveBeenCalledWith(7, { preview: true });
    // The W273/W376 purity assertion at component level: the real
    // `usePlaySession` gate (playSession.ts) must never call
    // `recordPlayStart` for a preview mount.
    expect(recordPlayStart).not.toHaveBeenCalled();

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    // A preview renders no chip bar / overlay chrome.
    expect(container.querySelector(".rgp-player__bar")).toBeNull();
  });

  it("records a play session for a non-preview (foreground) presentation", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <NativePlayer gameId={7} gameName="Real Game" presentation="foreground" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startNativePlay).toHaveBeenCalledWith(7, { preview: false });
    expect(recordPlayStart).toHaveBeenCalledWith(7);
  });
});
