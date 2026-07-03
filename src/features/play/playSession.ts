// usePlaySession — the shared "start on mount, end on unmount" play-session
// hook (v0.26 "library life", W264; docs/design/library-life-design.md). Both
// frontend play paths (InPagePlayer, NativePlayer) mount this once per game so
// the backend's `record_play_start` / `record_play_end` pair brackets exactly
// one played session, regardless of which player hosted it.
//
// This is a thin seam over the IPC calls so the "exactly once" bookkeeping —
// guard against a double-end, guard against ending a session that never
// started (start still in flight, or failed) — lives in one tested place
// instead of being re-derived per player.

import { useEffect, useRef } from "react";
import { recordPlayEnd, recordPlayStart } from "../../ipc/play-stats";

/** Tracks one play session's lifecycle so it starts and ends exactly once. */
export class PlaySessionTracker {
  private sessionId: number | null = null;
  private ending = false;

  /** Begins tracking; resolves once the backend has assigned a session id. */
  async start(gameId: number): Promise<void> {
    const id = await recordPlayStart(gameId);
    // If `end()` already ran before `start()` resolved (a very fast
    // mount/unmount), don't leave an orphaned session dangling — end it
    // immediately instead of "reviving" a session the caller already
    // considers over.
    if (this.ending) {
      void recordPlayEnd(id).catch(() => undefined);
      return;
    }
    this.sessionId = id;
  }

  /** Ends the tracked session, if any. Safe to call more than once. */
  end(): void {
    this.ending = true;
    const id = this.sessionId;
    this.sessionId = null;
    if (id !== null) {
      void recordPlayEnd(id).catch(() => undefined);
    }
  }
}

/**
 * Starts a play session for `gameId` when the component mounts (or `gameId`
 * changes) and ends it on unmount/change. A `beforeunload` listener also ends
 * the session so a window close mid-play still records the partial duration
 * rather than losing it entirely (the backend measures duration up to
 * whenever `record_play_end` actually arrives).
 *
 * `enabled` (default true) is the W273 purity seam: a spectator surface (the
 * TV hover-attract preview) mounts a player whose presentation must leave NO
 * library-life trace, so it passes
 * `presentationRecordsPlaySession(presentation)` here and the hook records
 * nothing at all — no `record_play_start`, no `record_play_end`. The flag
 * lives on the hook (not an `if` around it) because hooks cannot be
 * conditional.
 */
export function usePlaySession(gameId: number, enabled = true): void {
  const trackerRef = useRef<PlaySessionTracker | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const tracker = new PlaySessionTracker();
    trackerRef.current = tracker;
    void tracker.start(gameId);

    const onBeforeUnload = () => tracker.end();
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      tracker.end();
      trackerRef.current = null;
    };
  }, [gameId, enabled]);
}
