// useAchievementUnlocks — polls the native session for newly-unlocked
// RetroAchievements (v0.37 W372, retroachievements-design.md §Unlock UX +
// persistence) and hands back the one toast that should currently be shown
// in the player overlay. Mirrors NativePlayer's existing frame-poll cadence
// pattern (a plain `setInterval`, not requestAnimationFrame — unlocks are
// rare compared to frames, so a slower fixed cadence is enough and avoids
// spamming the IPC boundary on every rAF tick).
//
// Inert by construction when RA is unconfigured or the game has no set: the
// backend's `poll_achievement_unlocks` always resolves to an empty array in
// that case (see commands::achievements's doc), so this hook just never
// produces a toast — no separate "is RA enabled" flag needed here.

import { useEffect, useRef, useState } from "react";
import { pollAchievementUnlocks, type UnlockToast } from "../../ipc/retroachievements";
import { swallow } from "../../ipc/swallow";
import {
  advanceToastQueue,
  emptyToastQueue,
  enqueueToasts,
  type ToastQueueState,
} from "./achievementToastQueue";

/** How often to poll for newly-unlocked achievements while a native session
 * is running. Unlocks are comparatively rare events (at most a handful per
 * play session), so this is deliberately much slower than the video frame
 * poll — no user-perceptible reason to poll faster. */
const POLL_INTERVAL_MS = 1000;

/** How long a toast stays visible before the next queued one (if any) takes
 * its place — long enough to read a short title/description, short enough
 * not to block the overlay's non-intrusive "never captures input" contract
 * for very long even if several achievements unlock in a burst. */
const TOAST_VISIBLE_MS = 4000;

/**
 * Polls for achievement unlocks every [`POLL_INTERVAL_MS`] while `active` is
 * true (i.e. a real, non-preview native session is running — a preview
 * session never arms achievements backend-side, so polling it would only
 * waste an IPC round trip). Returns the single toast that should currently
 * render, or `null` when the queue is empty.
 */
export function useAchievementUnlocks(active: boolean): UnlockToast | null {
  const [queue, setQueue] = useState<ToastQueueState>(emptyToastQueue);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    if (!active) {
      setQueue(emptyToastQueue());
      return;
    }
    let cancelled = false;
    const interval = window.setInterval(() => {
      pollAchievementUnlocks()
        .then((toasts) => {
          if (cancelled || toasts.length === 0) return;
          setQueue((current) => enqueueToasts(current, toasts));
        })
        .catch((err: unknown) => swallow(err, "useAchievementUnlocks.poll", "info"));
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active]);

  // Auto-dismiss: whenever a new toast becomes `current`, schedule its
  // advance — re-armed each time `queue.current` changes (a new key means a
  // genuinely new toast took over, including the case where the SAME
  // achievement id shows twice).
  const currentKey = queue.current?.key ?? null;
  useEffect(() => {
    if (currentKey === null) return;
    const timeout = window.setTimeout(() => {
      setQueue((current) => (current.current?.key === currentKey ? advanceToastQueue(current) : current));
    }, TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [currentKey]);

  return queue.current?.toast ?? null;
}
