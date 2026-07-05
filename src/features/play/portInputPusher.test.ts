import { describe, expect, it } from "vitest";
import { assignPorts, emptyAssignments, NUM_NATIVE_PLAY_PORTS, padForPort } from "./gamepadAssignment";
import { computeJoypadBits, GAMEPAD_BINDINGS } from "./nativeInput";
import { PortInputPusher } from "./portInputPusher";

/** A controllable fake transport: records every send and lets a test settle each one. */
function fakeTransport() {
  const calls: Array<{ bits: number; port: number; resolve: () => void; reject: () => void }> = [];
  const send = (bits: number, port: number) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ bits, port, resolve, reject: () => reject(new Error("ipc failed")) });
    });
  return { calls, send };
}

/** Lets a settled promise's .catch handler run before the test continues. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const EMPTY_KEYS: ReadonlySet<string> = new Set();

describe("PortInputPusher", () => {
  it("tracks one memo slot per native play port by default (no hardcoded port count)", () => {
    const { send } = fakeTransport();
    expect(new PortInputPusher(send).portCount).toBe(NUM_NATIVE_PLAY_PORTS);
  });

  it("sends a port's first mask even when it is zero (nothing sent yet)", () => {
    const { calls, send } = fakeTransport();
    new PortInputPusher(send).push(0, 0);
    expect(calls).toMatchObject([{ bits: 0, port: 0 }]);
  });

  it("skips an unchanged mask instead of re-sending it every tick", () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    pusher.push(0, 5);
    calls[0].resolve();
    pusher.push(0, 5);
    pusher.push(0, 5);
    expect(calls).toHaveLength(1);
  });

  it("memoizes each port independently — a change on port 1 never re-sends port 0", () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    pusher.push(0, 5);
    pusher.push(1, 3);
    pusher.push(1, 7);
    expect(calls).toMatchObject([
      { bits: 5, port: 0 },
      { bits: 3, port: 1 },
      { bits: 7, port: 1 },
    ]);
  });

  it("sends a disconnect's zero-mask release exactly once across subsequent ticks", async () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    pusher.push(1, 9);
    calls[0].resolve();
    await flush();
    pusher.push(1, 0); // pad unplugged — recomputed mask collapses to zero
    pusher.push(1, 0);
    pusher.push(1, 0);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ bits: 0, port: 1 });
  });

  it("does not duplicate a push that is still in flight when the same mask recomputes next tick", () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    pusher.push(0, 5); // never settled — a slow IPC round trip
    pusher.push(0, 5);
    expect(calls).toHaveLength(1);
  });

  it("retries a rejected zero-mask release on the next tick instead of holding the stale mask forever", async () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    pusher.push(1, 9);
    calls[0].resolve();
    await flush();
    pusher.push(1, 0);
    calls[1].reject(); // the IPC push failed — the backend still holds mask 9
    await flush();
    pusher.push(1, 0); // next tick recomputes the same zero mask
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({ bits: 0, port: 1 });
  });

  it("after a rejected push, re-sends nothing if the mask returns to the last delivered value", async () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    pusher.push(0, 5);
    calls[0].resolve();
    await flush();
    pusher.push(0, 7);
    calls[1].reject(); // 7 never landed — the backend still holds 5
    await flush();
    pusher.push(0, 5); // the recomputed mask matches what the backend holds
    expect(calls).toHaveLength(2);
  });

  it("ignores a late rejection that lands after a newer push already took over the port", async () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    pusher.push(0, 5);
    pusher.push(0, 7); // supersedes 5 while it is still in flight
    calls[1].resolve();
    calls[0].reject(); // 5's late failure must not roll the memo back under 7
    await flush();
    pusher.push(0, 7);
    expect(calls).toHaveLength(2);
  });

  it("markAllReleased aligns the memo with an externally zeroed backend without sending", () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    pusher.push(0, 5);
    pusher.push(1, 3);
    calls.forEach((c) => c.resolve());
    pusher.markAllReleased(); // releaseAllNativeInput already zeroed every port
    expect(calls).toHaveLength(2);
    pusher.push(1, 0); // a pad that left while gated owes nothing further
    expect(calls).toHaveLength(2);
    pusher.push(0, 5); // a mask still physically held re-sends after ungating
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({ bits: 5, port: 0 });
  });
});

describe("poll-tick composition (assignment + pusher)", () => {
  /** A fake pad pressing the given standard-mapping button indices. */
  function pad(index: number, pressedButtons: number[] = []) {
    const highest = Math.max(-1, ...Object.keys(GAMEPAD_BINDINGS).map(Number));
    return {
      index,
      buttons: Array.from({ length: highest + 1 }, (_, i) => ({ pressed: pressedButtons.includes(i) })),
    };
  }

  /** One NativePlayer-style ungated poll tick: assign ports, then push every port's recomputed mask. */
  function tick(
    connected: ReadonlyArray<ReturnType<typeof pad> | null>,
    assignments: ReturnType<typeof emptyAssignments>,
    pusher: PortInputPusher,
  ) {
    const next = assignPorts(connected, assignments);
    for (let port = 0; port < next.length; port++) {
      pusher.push(port, computeJoypadBits(EMPTY_KEYS, padForPort(connected, next, port)));
    }
    return next;
  }

  it("a same-tick pad swap hands the port over without an intermediate zero mask", async () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    const [oldButton, newButton] = Object.keys(GAMEPAD_BINDINGS).map(Number);
    const oldPad = pad(3, [oldButton]);
    const newPad = pad(9, [newButton]);
    let assignments = tick([oldPad], emptyAssignments(), pusher);
    calls.forEach((c) => c.resolve());
    await flush();
    const sentBefore = calls.length;
    // Old pad disconnects AND a new pad (already holding a button) connects
    // in the SAME tick — the port hands over directly.
    assignments = tick([newPad], assignments, pusher);
    expect(assignments[0]).toBe(9);
    // Exactly one push for the handover: the new pad's mask, never a
    // 0-then-mask pair (no intermediate release for a port that stays claimed).
    const handoverCalls = calls.slice(sentBefore).filter((c) => c.port === 0);
    expect(handoverCalls).toHaveLength(1);
    expect(handoverCalls[0].bits).toBe(computeJoypadBits(EMPTY_KEYS, newPad));
    expect(handoverCalls[0].bits).not.toBe(0);
  });

  it("a disconnect with no replacement pushes the port's zero-mask release exactly once", () => {
    const { calls, send } = fakeTransport();
    const pusher = new PortInputPusher(send);
    const heldButton = Number(Object.keys(GAMEPAD_BINDINGS)[0]);
    let assignments = tick([pad(3, [heldButton])], emptyAssignments(), pusher);
    calls.forEach((c) => c.resolve());
    const sentBefore = calls.length;
    assignments = tick([], assignments, pusher); // unplugged mid-press
    assignments = tick([], assignments, pusher);
    tick([], assignments, pusher);
    const releases = calls.slice(sentBefore).filter((c) => c.port === 0);
    expect(releases).toHaveLength(1);
    expect(releases[0].bits).toBe(0);
  });
});
