// Unit tests for the TV home's rail-aware focus navigation (v0.26 W261). Pure,
// DOM-free: locateTile, resolveRailNav (left/right within a rail, up/down across
// rails with the hero as the top row, per-rail focus memory), and rememberFocus.

import { describe, it, expect } from "vitest";
import type { Game } from "../../ipc/library";
import type { TvRailModel } from "./rails";
import { tileFocusId } from "./rails";
import {
  HERO_FOCUS_ID,
  locateTile,
  rememberFocus,
  resolveRailNav,
} from "./railNav";

function game(id: number): Game {
  return {
    id,
    path: `/g${id}`,
    system: "nes",
    crc32: null,
    md5: null,
    cleanName: `Game ${id}`,
    datMatched: true,
    coreHint: null,
    artPath: null,
    sizeBytes: 0,
    addedAt: id,
    year: null,
    developer: null,
    publisher: null,
    aliases: [],
    description: null,
    wikipediaUrl: null,
    favorite: false,
    lastPlayedAt: null,
    playCount: 0,
    totalPlayTimeMs: 0,
  };
}

/** Two rails: rail A [g1,g2,g3], rail B [g4,g5]. */
const railA: TvRailModel = { id: "rail:a", label: "A", games: [game(1), game(2), game(3)] };
const railB: TvRailModel = { id: "rail:b", label: "B", games: [game(4), game(5)] };
const rails = [railA, railB];

const idA = (i: number) => tileFocusId(railA.id, railA.games[i].id);
const idB = (i: number) => tileFocusId(railB.id, railB.games[i].id);

describe("locateTile (v0.26 W261)", () => {
  it("finds a tile's rail + column", () => {
    expect(locateTile(rails, idA(1))).toEqual({ railIndex: 0, tileIndex: 1 });
    expect(locateTile(rails, idB(0))).toEqual({ railIndex: 1, tileIndex: 0 });
  });
  it("returns null for the hero id, null id, and stale ids", () => {
    expect(locateTile(rails, HERO_FOCUS_ID)).toBeNull();
    expect(locateTile(rails, null)).toBeNull();
    expect(locateTile(rails, "rail:a:999")).toBeNull();
  });
});

describe("resolveRailNav — within a rail (v0.26 W261)", () => {
  it("moves right and left, clamping at the ends (no wrap)", () => {
    expect(resolveRailNav(rails, idA(0), "right", {})).toBe(idA(1));
    expect(resolveRailNav(rails, idA(1), "left", {})).toBe(idA(0));
    // Left edge is an end-stop: stays put.
    expect(resolveRailNav(rails, idA(0), "left", {})).toBe(idA(0));
    // Right edge is an end-stop.
    expect(resolveRailNav(rails, idA(2), "right", {})).toBe(idA(2));
  });
});

describe("resolveRailNav — hero as the top row (v0.26 W261)", () => {
  it("down from the hero enters rail 0 at its remembered column", () => {
    expect(resolveRailNav(rails, HERO_FOCUS_ID, "down", {})).toBe(idA(0));
    expect(resolveRailNav(rails, HERO_FOCUS_ID, "down", { [railA.id]: 2 })).toBe(idA(2));
  });
  it("up from rail 0 returns to the hero", () => {
    expect(resolveRailNav(rails, idA(1), "up", {})).toBe(HERO_FOCUS_ID);
  });
  it("left/right/up on the hero stay put (single affordance)", () => {
    for (const dir of ["left", "right", "up"] as const) {
      expect(resolveRailNav(rails, HERO_FOCUS_ID, dir, {})).toBe(HERO_FOCUS_ID);
    }
  });
});

describe("resolveRailNav — across rails + focus memory (v0.26 W261)", () => {
  it("down from a rail enters the rail below at its remembered column", () => {
    // No memory for B → align to the current column (index 1), clamped to B's bounds.
    expect(resolveRailNav(rails, idA(1), "down", {})).toBe(idB(1));
    // Column 2 has no counterpart in B (len 2) → clamped to last tile.
    expect(resolveRailNav(rails, idA(2), "down", {})).toBe(idB(1));
    // Remembered column for B wins over column-alignment.
    expect(resolveRailNav(rails, idA(2), "down", { [railB.id]: 0 })).toBe(idB(0));
  });
  it("down from the last rail is an end-stop", () => {
    expect(resolveRailNav(rails, idB(0), "down", {})).toBe(idB(0));
  });
  it("up from rail 1 restores rail 0's remembered column", () => {
    expect(resolveRailNav(rails, idB(0), "up", { [railA.id]: 2 })).toBe(idA(2));
  });
  it("seeds onto the hero from a stale/unknown focus id", () => {
    expect(resolveRailNav(rails, "rail:a:999", "down", {})).toBe(HERO_FOCUS_ID);
  });
  it("returns null when there is nothing focusable at all", () => {
    expect(resolveRailNav([], "rail:x:1", "down", {})).toBeNull();
  });
});

describe("rememberFocus (v0.26 W261)", () => {
  it("records the focused tile's column, keyed by rail", () => {
    expect(rememberFocus(rails, {}, idA(2))).toEqual({ [railA.id]: 2 });
    expect(rememberFocus(rails, { [railA.id]: 2 }, idB(1))).toEqual({
      [railA.id]: 2,
      [railB.id]: 1,
    });
  });
  it("leaves memory unchanged for the hero id / a stale id", () => {
    const mem = { [railA.id]: 1 };
    expect(rememberFocus(rails, mem, HERO_FOCUS_ID)).toBe(mem);
    expect(rememberFocus(rails, mem, "rail:a:999")).toBe(mem);
  });
  it("is a no-op (same object) when the column is unchanged", () => {
    const mem = { [railA.id]: 2 };
    expect(rememberFocus(rails, mem, idA(2))).toBe(mem);
  });
  it("never mutates the input memory", () => {
    const mem = { [railA.id]: 0 };
    const next = rememberFocus(rails, mem, idA(2));
    expect(mem).toEqual({ [railA.id]: 0 });
    expect(next).not.toBe(mem);
  });
});
