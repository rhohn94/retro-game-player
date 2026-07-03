// Unit tests for the pure routing surface of useExclusiveControllerScope
// (W272). The claim/release effect itself needs a live ControllerProvider and
// is integration-verified on a real pad, matching the useGamepadPoll.test.ts
// pattern of testing the pure logic without hardware; the "backgrounded never
// holds the slot" leg of the contract is the presentationOwnsController
// predicate (presentation.test.ts) the hook gates its effect on.

import { describe, expect, it } from "vitest";
import { SEMANTIC_ACTIONS } from "../controller/actions";
import type { SemanticAction } from "../controller/actions";
import { routeScopedAction } from "./useExclusiveControllerScope";
import type { ScopeRouteState } from "./useExclusiveControllerScope";

const closed = (selection = 0, itemCount = 5): ScopeRouteState => ({
  overlayOpen: false,
  itemCount,
  selection,
});
const open = (selection = 0, itemCount = 5): ScopeRouteState => ({
  overlayOpen: true,
  itemCount,
  selection,
});

describe("routeScopedAction — overlay closed", () => {
  it("summons the overlay on menu", () => {
    expect(routeScopedAction("menu", closed())).toEqual({ kind: "open-overlay" });
  });

  it("swallows EVERY other semantic action (nothing leaks to the page beneath)", () => {
    const others = SEMANTIC_ACTIONS.filter((a) => a !== "menu");
    for (const action of others) {
      expect(routeScopedAction(action, closed()), action).toEqual({ kind: "swallow" });
    }
  });

  it("swallows confirm specifically — the PS ✕ that used to launch another game", () => {
    expect(routeScopedAction("confirm", closed())).toEqual({ kind: "swallow" });
  });
});

describe("routeScopedAction — overlay open", () => {
  it("moves the selection down with nav_down, wrapping past the last item", () => {
    expect(routeScopedAction("nav_down", open(0))).toEqual({ kind: "select", index: 1 });
    expect(routeScopedAction("nav_down", open(4))).toEqual({ kind: "select", index: 0 });
  });

  it("moves the selection up with nav_up, wrapping past the first item", () => {
    expect(routeScopedAction("nav_up", open(2))).toEqual({ kind: "select", index: 1 });
    expect(routeScopedAction("nav_up", open(0))).toEqual({ kind: "select", index: 4 });
  });

  it("activates the selected item on confirm", () => {
    expect(routeScopedAction("confirm", open(3))).toEqual({ kind: "activate", index: 3 });
  });

  it("closes (resumes) on back and on menu", () => {
    expect(routeScopedAction("back", open())).toEqual({ kind: "close-overlay" });
    expect(routeScopedAction("menu", open())).toEqual({ kind: "close-overlay" });
  });

  it("swallows the actions the overlay has no meaning for", () => {
    for (const action of ["nav_left", "nav_right", "quit"] as SemanticAction[]) {
      expect(routeScopedAction(action, open()), action).toEqual({ kind: "swallow" });
    }
  });

  it("swallows nav on an empty item list instead of selecting into nothing", () => {
    expect(routeScopedAction("nav_up", open(0, 0))).toEqual({ kind: "swallow" });
    expect(routeScopedAction("nav_down", open(0, 0))).toEqual({ kind: "swallow" });
  });
});
