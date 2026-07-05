/**
 * Direct unit tests for resultSort.ts (W367 test depth, v0.36).
 *
 * browsing.test.ts covers "found"/title-asc/title-desc and the persistence
 * helpers; this file adds the branch it left untested — sortItems("relevance")
 * — plus isSortKey's rejection of non-key strings beyond the single "bogus"
 * case already covered.
 */
import { describe, it, expect } from "vitest";
import { sortItems, isSortKey } from "./resultSort";

const items = [{ title: "B" }, { title: "A" }, { title: "C" }];

describe("sortItems", () => {
  it('"relevance" returns a shallow copy in original order, like "found"', () => {
    const out = sortItems(items, "relevance");
    expect(out).not.toBe(items);
    expect(out.map((i) => i.title)).toEqual(["B", "A", "C"]);
  });
});

describe("isSortKey", () => {
  it("rejects an empty string and a near-miss key", () => {
    expect(isSortKey("")).toBe(false);
    expect(isSortKey("title-ascending")).toBe(false);
  });
});
