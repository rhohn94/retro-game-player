// Unit tests for the pure, testable surface of useGameplayMenuTrigger
// (v0.28 W279): the per-tick button-state read, the chord/solo-hold
// predicates, and the duration -> elapsed/progress classifiers. The rAF
// polling loop itself needs a live `navigator.getGamepads`/hardware, matching
// the existing useLongPress.test.ts / useMenuTrigger.test.ts pattern of
// testing the pure logic without hardware.

import { describe, expect, it } from "vitest";
import { STANDARD_BUTTON } from "../controller/actions";
import {
  MENU_HOLD_MS,
  chordPressed,
  menuHoldElapsed,
  menuHoldProgress,
  readMenuTriggerButtons,
  soloHoldCandidate,
} from "./useGameplayMenuTrigger";

/** A minimal button array where only the given indices report pressed. */
function padWithPressed(...indices: number[]): { buttons: { pressed: boolean }[] } {
  const max = Math.max(0, ...indices);
  const buttons = Array.from({ length: max + 1 }, () => ({ pressed: false }));
  for (const i of indices) buttons[i] = { pressed: true };
  return { buttons };
}

describe("readMenuTriggerButtons", () => {
  it("reads Start and Select independently for every family", () => {
    const pad = padWithPressed(STANDARD_BUTTON.start);
    for (const fam of ["xbox", "playstation", "8bitdo", "switch_pro", "generic"] as const) {
      expect(readMenuTriggerButtons(pad, fam)).toEqual({
        startPressed: true,
        selectPressed: false,
      });
    }
  });

  it("reads both as pressed when both buttons are down", () => {
    const pad = padWithPressed(STANDARD_BUTTON.start, STANDARD_BUTTON.select);
    expect(readMenuTriggerButtons(pad, "xbox")).toEqual({
      startPressed: true,
      selectPressed: true,
    });
  });

  it("reads neither as pressed when nothing is down", () => {
    const pad = padWithPressed();
    expect(readMenuTriggerButtons(pad, "xbox")).toEqual({
      startPressed: false,
      selectPressed: false,
    });
  });

  it("follows a rebound menu (Start) override for the primary button", () => {
    const pad = padWithPressed(STANDARD_BUTTON.faceUp);
    const overrides = [{ deviceFamily: "xbox", action: "menu", button: "faceUp" }];
    expect(readMenuTriggerButtons(pad, "xbox", overrides)).toEqual({
      startPressed: true,
      selectPressed: false,
    });
    // The un-rebound Start index no longer reads as the trigger's Start.
    expect(readMenuTriggerButtons(padWithPressed(STANDARD_BUTTON.start), "xbox", overrides)).toEqual({
      startPressed: false,
      selectPressed: false,
    });
  });

  it("follows a rebound quit (Select) override for the secondary button", () => {
    const pad = padWithPressed(STANDARD_BUTTON.faceLeft);
    const overrides = [{ deviceFamily: "xbox", action: "quit", button: "faceLeft" }];
    expect(readMenuTriggerButtons(pad, "xbox", overrides)).toEqual({
      startPressed: false,
      selectPressed: true,
    });
  });
});

describe("chordPressed", () => {
  it("is true only when both Start and Select are pressed", () => {
    expect(chordPressed({ startPressed: true, selectPressed: true })).toBe(true);
    expect(chordPressed({ startPressed: true, selectPressed: false })).toBe(false);
    expect(chordPressed({ startPressed: false, selectPressed: true })).toBe(false);
    expect(chordPressed({ startPressed: false, selectPressed: false })).toBe(false);
  });
});

describe("soloHoldCandidate", () => {
  it("is true only when Start is down and Select is not", () => {
    expect(soloHoldCandidate({ startPressed: true, selectPressed: false })).toBe(true);
    expect(soloHoldCandidate({ startPressed: true, selectPressed: true })).toBe(false);
    expect(soloHoldCandidate({ startPressed: false, selectPressed: false })).toBe(false);
    expect(soloHoldCandidate({ startPressed: false, selectPressed: true })).toBe(false);
  });
});

describe("menuHoldElapsed", () => {
  it("has not elapsed before the threshold", () => {
    expect(menuHoldElapsed(0)).toBe(false);
    expect(menuHoldElapsed(MENU_HOLD_MS - 1)).toBe(false);
  });

  it("has elapsed exactly at the threshold", () => {
    expect(menuHoldElapsed(MENU_HOLD_MS)).toBe(true);
  });

  it("has elapsed well past the threshold", () => {
    expect(menuHoldElapsed(MENU_HOLD_MS * 2)).toBe(true);
  });

  it("honours a custom threshold override, independent of LONG_PRESS_MS", () => {
    expect(menuHoldElapsed(300, 250)).toBe(true);
    expect(menuHoldElapsed(200, 250)).toBe(false);
  });

  it("uses its own 5000ms constant, distinct from the unrelated 600ms long-press", () => {
    expect(MENU_HOLD_MS).toBe(5000);
  });
});

describe("menuHoldProgress", () => {
  it("is 0 at the start of a hold", () => {
    expect(menuHoldProgress(0)).toBe(0);
  });

  it("is a fraction partway through the threshold", () => {
    expect(menuHoldProgress(MENU_HOLD_MS / 2)).toBeCloseTo(0.5);
    expect(menuHoldProgress(MENU_HOLD_MS / 4)).toBeCloseTo(0.25);
  });

  it("is 1 at and beyond the threshold, never exceeding 1", () => {
    expect(menuHoldProgress(MENU_HOLD_MS)).toBe(1);
    expect(menuHoldProgress(MENU_HOLD_MS * 5)).toBe(1);
  });

  it("honours a custom threshold override", () => {
    expect(menuHoldProgress(125, 250)).toBeCloseTo(0.5);
  });
});
