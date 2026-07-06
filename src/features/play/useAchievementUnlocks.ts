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
//
// v0.38 W384 (retroachievements-design.md §Attract-backdrop unlock flush):
// polling and toast DISPLAY are now two independent flags rather than one
// `active` bool. `poll` keeps ticking (and persisting unlocks) through the
// W235 attract "background" presentation — a real, recording session whose
// unlocks are genuinely the user's — while `showToasts` is false there, so
// unlocks earned off-screen queue up silently instead of popping a toast over
// an unattended backdrop. The moment the presentation returns to foreground
// (or takeover) and `showToasts` flips true, the auto-dismiss timer arms for
// whatever is already `current` and the queue drains exactly as it always
// has. Only the W273 "preview" stops polling entirely (see the presentation
// module's own doc).

import { useEffect, useState } from "react";
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
 * Polls for achievement unlocks every [`POLL_INTERVAL_MS`] while `poll` is
 * true (a real, non-preview native session — see
 * `presentationPollsAchievements`), persisting them via the backend
 * regardless of display. Returns the single toast that should currently
 * RENDER, or `null` when either the queue is empty or `showToasts` is false
 * (a queued-but-unshown toast stays queued, not dropped — it surfaces the
 * moment `showToasts` flips true, e.g. on return to foreground).
 */
export function useAchievementUnlocks(poll: boolean, showToasts: boolean): UnlockToast | null {
  const [queue, setQueue] = useState<ToastQueueState>(emptyToastQueue);

  useEffect(() => {
    if (!poll) {
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
  }, [poll]);

  // Auto-dismiss: whenever a new toast becomes `current` AND is actually
  // being shown, schedule its advance — re-armed each time `queue.current`
  // OR `showToasts` changes, so a toast that was queued while suppressed
  // gets its full visible window starting from when it actually appears,
  // not from whenever it happened to be enqueued.
  const currentKey = queue.current?.key ?? null;
  useEffect(() => {
    if (currentKey === null || !showToasts) return;
    const timeout = window.setTimeout(() => {
      setQueue((current) => (current.current?.key === currentKey ? advanceToastQueue(current) : current));
    }, TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [currentKey, showToasts]);

  if (!showToasts) return null;
  return queue.current?.toast ?? null;
}
