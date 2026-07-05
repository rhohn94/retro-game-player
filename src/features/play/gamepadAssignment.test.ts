import { describe, expect, it } from "vitest";
import {
  assignPorts,
  connectedPortCount,
  emptyAssignments,
  NUM_NATIVE_PLAY_PORTS,
  padForPort,
  releasedPorts,
  type GamepadIndexSource,
} from "./gamepadAssignment";

function pad(index: number): GamepadIndexSource {
  return { index };
}

describe("emptyAssignments", () => {
  it("returns one null slot per hosted port", () => {
    expect(emptyAssignments()).toEqual(Array(NUM_NATIVE_PLAY_PORTS).fill(null));
  });
});

describe("assignPorts", () => {
  it("assigns the first-connected pad to port 0", () => {
    const next = assignPorts([pad(3)], emptyAssignments());
    expect(next).toEqual([3, null]);
  });

  it("assigns a second pad to port 1, keyed by index, regardless of array order", () => {
    let assignments = emptyAssignments();
    assignments = assignPorts([pad(3)], assignments);
    assignments = assignPorts([pad(3), pad(7)], assignments);
    expect(assignments).toEqual([3, 7]);
  });

  it("keeps an existing pad's port stable even if browser array order changes", () => {
    let assignments = emptyAssignments();
    assignments = assignPorts([pad(3)], assignments);
    assignments = assignPorts([pad(3), pad(7)], assignments);
    // getGamepads() can reorder; index 7 now appears before index 3.
    assignments = assignPorts([pad(7), pad(3)], assignments);
    expect(assignments).toEqual([3, 7]);
  });

  it("tolerates null holes in the connected array (getGamepads() sparse slots)", () => {
    const next = assignPorts([null, pad(2)], emptyAssignments());
    expect(next).toEqual([2, null]);
  });

  it("frees a port when its pad disconnects", () => {
    let assignments = emptyAssignments();
    assignments = assignPorts([pad(3), pad(7)], assignments);
    assignments = assignPorts([pad(3)], assignments);
    expect(assignments).toEqual([3, null]);
  });

  it("a reconnecting pad claims the lowest free port, not necessarily its old one", () => {
    let assignments = emptyAssignments();
    assignments = assignPorts([pad(3), pad(7)], assignments);
    assignments = assignPorts([pad(7)], assignments); // pad 3 (port 0) disconnects
    assignments = assignPorts([pad(7), pad(9)], assignments); // a new pad connects
    expect(assignments).toEqual([9, 7]);
  });

  it("leaves a third pad unassigned once both ports are taken", () => {
    let assignments = emptyAssignments();
    assignments = assignPorts([pad(1), pad(2)], assignments);
    assignments = assignPorts([pad(1), pad(2), pad(3)], assignments);
    expect(assignments).toEqual([1, 2]);
  });

  it("returns an all-null table when nothing is connected", () => {
    expect(assignPorts([], emptyAssignments())).toEqual([null, null]);
  });
});

describe("releasedPorts", () => {
  it("reports no ports released when nothing changed", () => {
    const assignments = assignPorts([pad(1), pad(2)], emptyAssignments());
    expect(releasedPorts(assignments, assignments)).toEqual([]);
  });

  it("reports the port that lost its pad", () => {
    const before = assignPorts([pad(1), pad(2)], emptyAssignments());
    const after = assignPorts([pad(1)], before);
    expect(releasedPorts(before, after)).toEqual([1]);
  });

  it("reports both ports released when both pads disconnect", () => {
    const before = assignPorts([pad(1), pad(2)], emptyAssignments());
    const after = assignPorts([], before);
    expect(releasedPorts(before, after)).toEqual([0, 1]);
  });

  it("does not report a port that was never assigned", () => {
    expect(releasedPorts(emptyAssignments(), emptyAssignments())).toEqual([]);
  });
});

describe("padForPort", () => {
  it("returns the pad object assigned to a port", () => {
    const connected = [pad(1), pad(2)];
    const assignments = assignPorts(connected, emptyAssignments());
    expect(padForPort(connected, assignments, 0)).toBe(connected[0]);
    expect(padForPort(connected, assignments, 1)).toBe(connected[1]);
  });

  it("returns null for an unassigned port", () => {
    const connected = [pad(1)];
    const assignments = assignPorts(connected, emptyAssignments());
    expect(padForPort(connected, assignments, 1)).toBeNull();
  });

  it("returns null when the assigned pad is no longer in the connected list", () => {
    const assignments = assignPorts([pad(1)], emptyAssignments());
    expect(padForPort([], assignments, 0)).toBeNull();
  });
});

describe("connectedPortCount", () => {
  it("is 0 for an empty table", () => {
    expect(connectedPortCount(emptyAssignments())).toBe(0);
  });

  it("counts each assigned port once", () => {
    const assignments = assignPorts([pad(1), pad(2)], emptyAssignments());
    expect(connectedPortCount(assignments)).toBe(2);
  });

  it("counts a single assigned port", () => {
    const assignments = assignPorts([pad(1)], emptyAssignments());
    expect(connectedPortCount(assignments)).toBe(1);
  });
});
