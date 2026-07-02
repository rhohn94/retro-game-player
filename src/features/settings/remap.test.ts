// Unit tests for the pure rebind/conflict logic (W267). No hardware, no DOM —
// exercises the merge rules directly against BindingMap fixtures.

import { describe, expect, it } from "vitest";
import { defaultBindings, STANDARD_BUTTON } from "../controller";
import {
  ACTION_LABEL,
  UNBOUND,
  applyRebind,
  bindingRows,
  buttonDisplayLabel,
  buttonIndexToStoredName,
  diffBindings,
  findConflict,
} from "./remap";

describe("buttonIndexToStoredName", () => {
  it("names a STANDARD_BUTTON index by its key", () => {
    expect(buttonIndexToStoredName(STANDARD_BUTTON.faceDown)).toBe("faceDown");
    expect(buttonIndexToStoredName(STANDARD_BUTTON.dpadUp)).toBe("dpadUp");
  });

  it("falls back to the numeric string for an unnamed index", () => {
    expect(buttonIndexToStoredName(11)).toBe("11");
  });
});

describe("buttonDisplayLabel", () => {
  it("renders UNBOUND as Unassigned", () => {
    expect(buttonDisplayLabel(UNBOUND)).toBe("Unassigned");
  });

  it("humanizes a named STANDARD_BUTTON key", () => {
    expect(buttonDisplayLabel(STANDARD_BUTTON.faceDown)).toBe("Face Down");
    expect(buttonDisplayLabel(STANDARD_BUTTON.dpadUp)).toBe("Dpad Up");
  });

  it("falls back to 'Button N' for an unnamed index", () => {
    expect(buttonDisplayLabel(11)).toBe("Button 11");
  });
});

describe("bindingRows", () => {
  it("lists every semantic action with its bound button, in the canonical order", () => {
    const rows = bindingRows(defaultBindings("xbox"));
    expect(rows.map((r) => r.action)).toEqual([
      "confirm",
      "back",
      "nav_up",
      "nav_down",
      "nav_left",
      "nav_right",
      "menu",
      "quit",
    ]);
    expect(rows.find((r) => r.action === "confirm")?.buttonIndex).toBe(STANDARD_BUTTON.faceDown);
  });

  it("every action has a display label", () => {
    for (const action of bindingRows(defaultBindings("generic")).map((r) => r.action)) {
      expect(ACTION_LABEL[action]).toBeTruthy();
    }
  });
});

describe("findConflict", () => {
  it("returns null when the button is free", () => {
    const bindings = defaultBindings("xbox");
    expect(findConflict(bindings, "menu", 6)).toBeNull();
  });

  it("finds the other action already bound to that button", () => {
    const bindings = defaultBindings("xbox"); // confirm=faceDown(0), back=faceRight(1)
    expect(findConflict(bindings, "menu", STANDARD_BUTTON.faceDown)).toBe("confirm");
  });

  it("does not report a conflict against the action's own current button", () => {
    const bindings = defaultBindings("xbox");
    expect(findConflict(bindings, "confirm", STANDARD_BUTTON.faceDown)).toBeNull();
  });

  it("never reports UNBOUND as a conflict, even if multiple actions share it", () => {
    const bindings = { ...defaultBindings("xbox"), menu: UNBOUND, quit: UNBOUND };
    expect(findConflict(bindings, "back", UNBOUND)).toBeNull();
  });
});

describe("applyRebind", () => {
  it("rebinds directly when there is no conflict", () => {
    const bindings = defaultBindings("xbox");
    const next = applyRebind(bindings, "menu", 6);
    expect(next.menu).toBe(6);
    // Every other action is unchanged.
    for (const action of Object.keys(bindings) as (keyof typeof bindings)[]) {
      if (action !== "menu") expect(next[action]).toBe(bindings[action]);
    }
  });

  it("does not mutate the input map", () => {
    const bindings = defaultBindings("xbox");
    const snapshot = { ...bindings };
    applyRebind(bindings, "menu", 6);
    expect(bindings).toEqual(snapshot);
  });

  it("returns an unchanged copy when a conflict exists but no resolution is given", () => {
    const bindings = defaultBindings("xbox");
    const next = applyRebind(bindings, "menu", STANDARD_BUTTON.faceDown);
    expect(next).toEqual(bindings);
    expect(next).not.toBe(bindings); // still a fresh object, not a mutation
  });

  it("swap exchanges the two actions' buttons", () => {
    const bindings = defaultBindings("xbox"); // confirm=0, menu=9(start)
    const next = applyRebind(bindings, "menu", STANDARD_BUTTON.faceDown, "swap");
    expect(next.menu).toBe(STANDARD_BUTTON.faceDown);
    expect(next.confirm).toBe(bindings.menu); // confirm took menu's old button
  });

  it("clear leaves the rebound action assigned and unassigns the loser", () => {
    const bindings = defaultBindings("xbox");
    const next = applyRebind(bindings, "menu", STANDARD_BUTTON.faceDown, "clear");
    expect(next.menu).toBe(STANDARD_BUTTON.faceDown);
    expect(next.confirm).toBe(UNBOUND);
  });

  it("swap round-trips: swapping back restores the original map", () => {
    const bindings = defaultBindings("xbox"); // confirm=faceDown(0), menu=start(9)
    const once = applyRebind(bindings, "menu", STANDARD_BUTTON.faceDown, "swap");
    // once: menu=faceDown(0), confirm=start(9). Swapping menu back to start
    // conflicts with confirm (now holding start) — resolve with "swap" again.
    const twice = applyRebind(once, "menu", STANDARD_BUTTON.start, "swap");
    expect(twice).toEqual(bindings);
  });
});

describe("diffBindings", () => {
  it("reports no rows when nothing changed", () => {
    const bindings = defaultBindings("xbox");
    expect(diffBindings(bindings, { ...bindings })).toEqual([]);
  });

  it("reports only the actions whose button changed, with storable names", () => {
    const bindings = defaultBindings("xbox");
    const next = applyRebind(bindings, "menu", STANDARD_BUTTON.faceDown, "swap");
    const rows = diffBindings(bindings, next);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { action: "menu", button: "faceDown" },
        { action: "confirm", button: "start" },
      ]),
    );
  });

  it("stores UNBOUND as its numeric token so a clear round-trips", () => {
    const bindings = defaultBindings("xbox");
    const next = applyRebind(bindings, "menu", STANDARD_BUTTON.faceDown, "clear");
    const rows = diffBindings(bindings, next);
    expect(rows).toEqual(
      expect.arrayContaining([{ action: "confirm", button: String(UNBOUND) }]),
    );
  });
});
