// Unit tests for PlaySessionTracker — the shared per-play-path session seam
// (v0.26 "library life", W264). Mocks the IPC boundary so the tracker's
// exactly-once start/end bookkeeping is verified without a real backend.

import { describe, expect, it, vi, beforeEach } from "vitest";

const recordPlayStart = vi.fn<(gameId: number) => Promise<number>>();
const recordPlayEnd = vi.fn<(sessionId: number) => Promise<void>>();

vi.mock("../../ipc/play-stats", () => ({
  recordPlayStart: (gameId: number) => recordPlayStart(gameId),
  recordPlayEnd: (sessionId: number) => recordPlayEnd(sessionId),
}));

// Imported after the mock so the module under test picks up the mocked ipc.
const { PlaySessionTracker } = await import("./playSession");

beforeEach(() => {
  recordPlayStart.mockReset();
  recordPlayEnd.mockReset();
  recordPlayStart.mockResolvedValue(1);
  recordPlayEnd.mockResolvedValue(undefined);
});

describe("PlaySessionTracker", () => {
  it("starts a session for the given game id", async () => {
    const tracker = new PlaySessionTracker();
    await tracker.start(7);
    expect(recordPlayStart).toHaveBeenCalledWith(7);
    expect(recordPlayEnd).not.toHaveBeenCalled();
  });

  it("ends the session that was started", async () => {
    recordPlayStart.mockResolvedValue(42);
    const tracker = new PlaySessionTracker();
    await tracker.start(7);
    tracker.end();
    expect(recordPlayEnd).toHaveBeenCalledWith(42);
  });

  it("calling end twice only records one recordPlayEnd call", async () => {
    const tracker = new PlaySessionTracker();
    await tracker.start(7);
    tracker.end();
    tracker.end();
    expect(recordPlayEnd).toHaveBeenCalledTimes(1);
  });

  it("calling end before start resolves ends the session as soon as it arrives", async () => {
    let resolveStart!: (id: number) => void;
    recordPlayStart.mockReturnValue(
      new Promise<number>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const tracker = new PlaySessionTracker();
    const startPromise = tracker.start(7);
    tracker.end(); // unmounted before the start IPC call resolved
    expect(recordPlayEnd).not.toHaveBeenCalled(); // no session id yet

    resolveStart(99);
    await startPromise;

    expect(recordPlayEnd).toHaveBeenCalledWith(99);
  });

  it("never calls recordPlayEnd if end() is never invoked", async () => {
    const tracker = new PlaySessionTracker();
    await tracker.start(7);
    expect(recordPlayEnd).not.toHaveBeenCalled();
  });
});
