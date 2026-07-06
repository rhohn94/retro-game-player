// Pure queue logic for the achievement-unlock toast (v0.37 W372,
// retroachievements-design.md §Unlock UX + persistence). Kept separate from
// the polling hook (useAchievementUnlocks.ts) so the "one visible at a time,
// FIFO, auto-dismiss" behaviour is unit-testable without a fake timer/IPC
// harness — mirrors this app's existing split between a pure computation
// module and its consuming hook (e.g. gamepadAssignment.ts / NativePlayer's
// poll loop).

import type { UnlockToast } from "../../ipc/retroachievements";

/** How many toasts have been queued so far — a react `key` needs a stable
 * per-toast identity distinct from `achievementId` alone, since the SAME
 * achievement id showing twice (a defensive edge case; unlocks don't
 * normally repeat) must still render as two distinct toast instances. */
export interface QueuedToast {
  key: number;
  toast: UnlockToast;
}

/** The toast queue's state: the currently-shown toast (if any) plus every
 * toast still waiting behind it. */
export interface ToastQueueState {
  current: QueuedToast | null;
  pending: QueuedToast[];
  nextKey: number;
}

/** A fresh, empty queue. */
export function emptyToastQueue(): ToastQueueState {
  return { current: null, pending: [], nextKey: 0 };
}

/** Appends newly-polled toasts to the queue, promoting the first one to
 * `current` immediately if nothing was already showing — never replaces an
 * already-visible toast (multiple simultaneous unlocks queue up rather than
 * clobbering each other, per the design doc's "queued if multiple"). */
export function enqueueToasts(state: ToastQueueState, incoming: UnlockToast[]): ToastQueueState {
  if (incoming.length === 0) return state;
  let nextKey = state.nextKey;
  const queued = incoming.map((toast) => ({ key: nextKey++, toast }));
  if (state.current === null) {
    const [first, ...rest] = queued;
    return { current: first, pending: [...state.pending, ...rest], nextKey };
  }
  return { current: state.current, pending: [...state.pending, ...queued], nextKey };
}

/** Dismisses the current toast, promoting the next queued one (if any) to
 * take its place — called on auto-dismiss timeout. */
export function advanceToastQueue(state: ToastQueueState): ToastQueueState {
  const [next = null, ...rest] = state.pending;
  return { current: next, pending: rest, nextKey: state.nextKey };
}
