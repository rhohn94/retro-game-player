// portInputPusher — memoized per-port delivery of native joypad bitmasks
// (v0.35 "Player Two" W351, controller-input-design.md §Two-player capture).
// NativePlayer's poll tick recomputes every port's mask each frame; this class
// owns the "did the backend already hear this?" bookkeeping so an unchanged
// mask never re-sends, a port whose pad just disconnected gets its zero-mask
// release pushed exactly once, and a push the IPC layer REJECTS is retried on
// a later tick instead of being remembered as delivered (previously a failed
// disconnect release left the stale mask held backend-side forever).
//
// Pure of DOM/IPC (the send function is injected) so the exactly-once and
// retry-on-failure properties are unit-testable with a fake transport;
// NativePlayer.tsx is the only impure caller (it injects `setNativeInput`).

import { NUM_NATIVE_PLAY_PORTS } from "./gamepadAssignment";

/** Sentinel "nothing sent yet" memo value — never matches a real bitmask, so a port's first push always sends. */
const NEVER_SENT = -1;

/** The injected transport: push `bits` to the core's input `port` (IPC in production). */
export type PortInputSend = (bits: number, port: number) => Promise<void>;

/** Memoizes the last mask successfully handed to each port's transport, skipping duplicates and retrying failures. */
export class PortInputPusher {
  /** `lastSentBits[port]` — the mask this pusher currently believes the backend holds for `port`. */
  private readonly lastSentBits: number[];

  constructor(
    private readonly send: PortInputSend,
    portCount: number = NUM_NATIVE_PLAY_PORTS,
  ) {
    this.lastSentBits = Array<number>(portCount).fill(NEVER_SENT);
  }

  /** How many ports this pusher tracks (mirrors the native runtime's port count by default). */
  get portCount(): number {
    return this.lastSentBits.length;
  }

  /**
   * Sends `bits` to `port` unless it matches the last mask believed delivered.
   * The memo is set optimistically (so a slow in-flight push is never
   * duplicated by the next tick) and rolled back if the transport rejects —
   * the caller's next recompute then retries, so a failed zero-mask release
   * can never leave the previous mask held backend-side forever. A rejection
   * that lands after a NEWER push already updated the memo is ignored (that
   * push's own rollback handles its own failure).
   */
  push(port: number, bits: number): void {
    const prev = this.lastSentBits[port];
    if (bits === prev) return;
    this.lastSentBits[port] = bits;
    void this.send(bits, port).catch(() => {
      if (this.lastSentBits[port] === bits) this.lastSentBits[port] = prev;
    });
  }

  /**
   * Records that every port's backend mask is now zero WITHOUT sending
   * anything — for the caller's overlay/spectator gate, where
   * `releaseAllNativeInput()` already zeroed every port at the transition.
   * Keeps the memo aligned with that all-zero backend state, so ungating
   * re-sends any mask still physically held (and a port whose pad left while
   * gated correctly re-sends nothing).
   */
  markAllReleased(): void {
    this.lastSentBits.fill(0);
  }
}
