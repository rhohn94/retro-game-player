// Unit tests for the pure TvSystemMenu list model (v0.28 W278).

import { describe, expect, it } from "vitest";
import { TV_MENU_ITEMS, nextMenuIndex } from "./systemMenu";

describe("TV_MENU_ITEMS", () => {
  it("lists TV Home, every primary route, then Exit TV mode in order", () => {
    expect(TV_MENU_ITEMS.map((i) => i.label)).toEqual([
      "TV Home",
      "Consoles",
      "Search",
      "Cores",
      "Settings",
      "Exit TV mode",
    ]);
  });

  it("has unique ids", () => {
    const ids = TV_MENU_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("routes every non-home/exit destination through a real HARMONY_ROUTES path", () => {
    const routePaths = ["/consoles", "/search", "/cores", "/settings"];
    const menuRoutePaths = TV_MENU_ITEMS.filter((i) => i.destination.kind === "route").map(
      (i) => (i.destination as { kind: "route"; path: string }).path,
    );
    expect(menuRoutePaths).toEqual(routePaths);
  });
});

describe("nextMenuIndex", () => {
  it("moves down one row at a time", () => {
    expect(nextMenuIndex(0, "down")).toBe(1);
    expect(nextMenuIndex(1, "down")).toBe(2);
  });

  it("moves up one row at a time", () => {
    expect(nextMenuIndex(2, "up")).toBe(1);
  });

  it("end-stops at the first row (no wraparound)", () => {
    expect(nextMenuIndex(0, "up")).toBe(0);
  });

  it("end-stops at the last row (no wraparound)", () => {
    const last = TV_MENU_ITEMS.length - 1;
    expect(nextMenuIndex(last, "down")).toBe(last);
  });
});
