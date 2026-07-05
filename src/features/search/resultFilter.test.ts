/**
 * Direct unit tests for resultFilter.ts (W367 test depth, v0.36).
 *
 * browsing.test.ts already covers the basic title/url substring match;
 * this file adds the branches that module didn't exercise directly:
 * filterItems narrowing to an empty result, and matchesFilter against a
 * query that matches neither field.
 */
import { describe, it, expect } from "vitest";
import { matchesFilter, filterItems, type FilterableItem } from "./resultFilter";

const items: FilterableItem[] = [
  { title: "Metroid", url: "https://example.com/metroid" },
  { title: "Contra", url: "https://example.com/contra" },
];

describe("matchesFilter", () => {
  it("returns false when the query matches neither title nor url", () => {
    expect(matchesFilter(items[0], "castlevania")).toBe(false);
  });
});

describe("filterItems", () => {
  it("narrows to an empty array when nothing matches", () => {
    expect(filterItems(items, "castlevania")).toEqual([]);
  });

  it("is case-insensitive and trims the query before matching", () => {
    expect(filterItems(items, "  CONTRA  ").map((i) => i.title)).toEqual(["Contra"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...items];
    filterItems(items, "contra");
    expect(items).toEqual(copy);
  });
});
