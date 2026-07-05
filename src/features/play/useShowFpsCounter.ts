// useShowFpsCounter — loads + toggles the persisted "show on-screen FPS
// counter" preference (v0.29 W281, performance-tooling-design.md). Shared by
// both players (read-only consumption, like useCrtFilter's `config`) and the
// Settings → Playback pane (read/write, via the returned setter) — mirrors
// the shape of usePlayerPrefs/useCrtFilter rather than introducing a new
// pattern.

import { useCallback, useEffect, useState } from "react";
import { getShowFpsCounter, setShowFpsCounter as persistShowFpsCounter } from "../../ipc/perf-tools";
import { swallow } from "../../ipc/swallow";

export interface ShowFpsCounterState {
  /** Whether the on-screen FPS counter is enabled; `false` until the initial
   * load resolves (an inert default — no surprise overlay on first paint). */
  enabled: boolean;
  /** Applies + persists the toggle immediately (a discrete on/off action,
   * unlike a slider drag — no debounce needed). */
  setEnabled: (enabled: boolean) => void;
}

/** Read/write hook for the FPS-counter toggle. */
export function useShowFpsCounterState(): ShowFpsCounterState {
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getShowFpsCounter()
      .then((v) => {
        if (!cancelled) setEnabledState(v);
      })
      .catch((err: unknown) => swallow(err, "useShowFpsCounterState.load")); // false stands
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    void persistShowFpsCounter(next).catch((err: unknown) => swallow(err, "useShowFpsCounterState.setEnabled"));
  }, []);

  return { enabled, setEnabled };
}

/** Read-only convenience for consumers (both players) that only need the
 * live value, not the setter — a thin wrapper so call sites read cleanly. */
export function useShowFpsCounter(): boolean {
  return useShowFpsCounterState().enabled;
}
