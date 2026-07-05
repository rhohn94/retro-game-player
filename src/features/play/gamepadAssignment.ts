// gamepadAssignment — pure gamepad-index -> input-port assignment for
// two-controller native play (v0.35 "Player Two" W351,
// controller-input-design.md §Two-player capture). Mirrors the backend's
// `NUM_NATIVE_INPUT_PORTS` (src-tauri/src/play/native/callbacks.rs): ports
// 0 and 1 this release.
//
// Policy: first-connected pad claims port 0, second claims port 1, keyed by
// stable `Gamepad.index` (the browser assigns and holds an index for a pad's
// whole connected lifetime). A disconnect frees its port; a later reconnect
// (a new or different pad) claims the LOWEST free port, not necessarily the
// one it previously held — there is no per-pad memory across a disconnect.
//
// Pure (no DOM) so the assignment/reassignment logic is unit-testable with
// fake pad objects; `NativePlayer.tsx` is the only impure caller (it feeds
// this module the array `navigator.getGamepads()` returns each poll tick).

/** Native play hosts this many input ports this release (v0.35 W350/W351). */
export const NUM_NATIVE_PLAY_PORTS = 2;

/** Minimal shape of a `Gamepad` this module needs, so tests don't require a real one. */
export interface GamepadIndexSource {
  index: number;
}

/** One assignment table: `assignments[port]` is the connected pad's `Gamepad.index`, or `null` if that port is unclaimed. */
export type PortAssignments = ReadonlyArray<number | null>;

/** The empty table — every port unclaimed. */
export function emptyAssignments(): PortAssignments {
  return Array<number | null>(NUM_NATIVE_PLAY_PORTS).fill(null);
}

/**
 * Recomputes port assignments for the currently-connected pads, given the
 * previous tick's assignments. Stability rule: a pad already holding a port
 * keeps it for as long as it stays connected — only a pad's own disconnect
 * frees its port, so pad order in the browser's `getGamepads()` array (which
 * can reflow) never reshuffles an existing assignment. A newly-seen index
 * (not held by any port previously) claims the lowest free port; if every
 * port is already taken, the extra pad is simply unassigned (out of scope
 * this release — see the design doc's non-goals).
 */
export function assignPorts(
  connected: ReadonlyArray<GamepadIndexSource | null>,
  previous: PortAssignments,
): PortAssignments {
  const connectedIndices = new Set(connected.filter((p): p is GamepadIndexSource => p != null).map((p) => p.index));

  // Carry forward every still-connected pad's existing port.
  const next: Array<number | null> = previous.map((heldIndex) =>
    heldIndex != null && connectedIndices.has(heldIndex) ? heldIndex : null,
  );

  // Assign newly-seen pads (not already carried forward) to the lowest free port.
  const alreadyAssigned = new Set(next.filter((i): i is number => i != null));
  for (const index of connectedIndices) {
    if (alreadyAssigned.has(index)) continue;
    const freePort = next.indexOf(null);
    if (freePort === -1) continue; // every port taken — extra pads unassigned this release
    next[freePort] = index;
    alreadyAssigned.add(index);
  }

  return next;
}

/**
 * Which ports were assigned in `previous` but are unassigned in `next` —
 * i.e. ports that just lost their pad this tick and need exactly one
 * zero-mask release pushed for them.
 */
export function releasedPorts(previous: PortAssignments, next: PortAssignments): number[] {
  const released: number[] = [];
  for (let port = 0; port < previous.length; port++) {
    if (previous[port] != null && next[port] == null) released.push(port);
  }
  return released;
}

/** Looks up the connected `Gamepad` (or fake) assigned to `port`, or `null`. */
export function padForPort<T extends GamepadIndexSource>(
  connected: ReadonlyArray<T | null>,
  assignments: PortAssignments,
  port: number,
): T | null {
  const index = assignments[port];
  if (index == null) return null;
  return connected.find((p): p is T => p != null && p.index === index) ?? null;
}

/** How many ports currently have a pad assigned — drives the "P1"/"P1 P2" indicator. */
export function connectedPortCount(assignments: PortAssignments): number {
  return assignments.filter((i) => i != null).length;
}
