// Unit tests for the spatial focus engine (W14). Pure geometry — a 2x2 grid of
// rects exercises directional nearest-neighbour selection.

import { describe, expect, it } from "vitest";
import { nextFocus, navDirection, type FocusTarget } from "./spatial";

function tile(id: string, col: number, row: number): FocusTarget {
  const x = col * 100;
  const y = row * 100;
  return { id, rect: { left: x, right: x + 80, top: y, bottom: y + 80 } };
}

// Grid:  a b
//        c d
const grid: FocusTarget[] = [tile("a", 0, 0), tile("b", 1, 0), tile("c", 0, 1), tile("d", 1, 1)];

describe("navDirection", () => {
  it("maps nav actions to directions and rejects non-nav actions", () => {
    expect(navDirection("nav_up")).toBe("up");
    expect(navDirection("nav_right")).toBe("right");
    expect(navDirection("confirm")).toBeNull();
  });
});

describe("nextFocus", () => {
  it("moves right/down/left/up across the grid", () => {
    expect(nextFocus(grid, "a", "right")).toBe("b");
    expect(nextFocus(grid, "a", "down")).toBe("c");
    expect(nextFocus(grid, "d", "left")).toBe("c");
    expect(nextFocus(grid, "d", "up")).toBe("b");
  });

  it("returns null at an edge (no target that way)", () => {
    expect(nextFocus(grid, "a", "up")).toBeNull();
    expect(nextFocus(grid, "b", "right")).toBeNull();
  });

  it("claims the first target when current id is unknown", () => {
    expect(nextFocus(grid, null, "down")).toBe("a");
    expect(nextFocus(grid, "ghost", "left")).toBe("a");
  });

  it("returns null for an empty target set", () => {
    expect(nextFocus([], "a", "down")).toBeNull();
  });
});
