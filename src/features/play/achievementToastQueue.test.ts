// Tests for achievementToastQueue.ts (v0.37 W372).
import { describe, expect, it } from "vitest";
import {
  advanceToastQueue,
  emptyToastQueue,
  enqueueToasts,
} from "./achievementToastQueue";
import type { UnlockToast } from "../../ipc/retroachievements";

function toast(achievementId: number, title = `Achievement ${achievementId}`): UnlockToast {
  return { achievementId, title, description: "desc", points: 10, badgeName: null };
}

describe("emptyToastQueue", () => {
  it("starts with no current toast and nothing pending", () => {
    const state = emptyToastQueue();
    expect(state.current).toBeNull();
    expect(state.pending).toEqual([]);
  });
});

describe("enqueueToasts", () => {
  it("is a no-op for an empty incoming list", () => {
    const state = emptyToastQueue();
    const next = enqueueToasts(state, []);
    expect(next).toBe(state);
  });

  it("promotes the first incoming toast to current when nothing is showing", () => {
    const state = enqueueToasts(emptyToastQueue(), [toast(1)]);
    expect(state.current?.toast.achievementId).toBe(1);
    expect(state.pending).toEqual([]);
  });

  it("queues every incoming toast behind an already-visible one", () => {
    let state = enqueueToasts(emptyToastQueue(), [toast(1)]);
    state = enqueueToasts(state, [toast(2), toast(3)]);

    expect(state.current?.toast.achievementId).toBe(1);
    expect(state.pending.map((q) => q.toast.achievementId)).toEqual([2, 3]);
  });

  it("assigns each queued toast a distinct key even for a repeated achievement id", () => {
    let state = enqueueToasts(emptyToastQueue(), [toast(1)]);
    state = enqueueToasts(state, [toast(1)]);

    expect(state.current?.key).not.toBe(state.pending[0]?.key);
  });
});

describe("advanceToastQueue", () => {
  it("clears current when nothing is pending", () => {
    const state = enqueueToasts(emptyToastQueue(), [toast(1)]);
    const next = advanceToastQueue(state);
    expect(next.current).toBeNull();
    expect(next.pending).toEqual([]);
  });

  it("promotes the next pending toast to current, preserving FIFO order", () => {
    let state = enqueueToasts(emptyToastQueue(), [toast(1)]);
    state = enqueueToasts(state, [toast(2), toast(3)]);

    const next = advanceToastQueue(state);
    expect(next.current?.toast.achievementId).toBe(2);
    expect(next.pending.map((q) => q.toast.achievementId)).toEqual([3]);

    const after = advanceToastQueue(next);
    expect(after.current?.toast.achievementId).toBe(3);
    expect(after.pending).toEqual([]);

    const final = advanceToastQueue(after);
    expect(final.current).toBeNull();
  });
});
