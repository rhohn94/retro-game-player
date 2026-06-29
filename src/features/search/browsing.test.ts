/**
 * Unit tests for the v0.17 "Sift" result-browsing logic — the pure modules
 * behind the Search results toolbar (filter, sort, badges, selection). These
 * run framework-free in node; the React wiring in SearchPage.tsx is exercised
 * by the headless mock-IPC screenshot pass during implementation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { matchesFilter, filterItems } from "./resultFilter";
import {
  sortItems,
  isSortKey,
  SORT_KEYS,
  loadSortPref,
  saveSortPref,
} from "./resultSort";
import { parseBadges } from "./resultBadges";
import {
  groupSelectionState,
  withGroupToggled,
  withItemToggled,
  needsOpenConfirm,
  OPEN_CONFIRM_THRESHOLD,
} from "./resultSelection";

const items = [
  { title: "Super Mario Bros. 3 (USA)", url: "https://archive.org/details/smb3-usa" },
  { title: "Sonic the Hedgehog (Europe)", url: "https://archive.org/details/sonic-eur" },
  { title: "Chrono Trigger (Japan)", url: "https://example.com/ct-jp" },
];

// ── resultFilter (W171) ──────────────────────────────────────────────────────

describe("resultFilter", () => {
  it("matches on title substring, case-insensitively", () => {
    expect(matchesFilter(items[0], "mario")).toBe(true);
    expect(matchesFilter(items[0], "MARIO")).toBe(true);
    expect(matchesFilter(items[0], "luigi")).toBe(false);
  });

  it("matches on url substring", () => {
    expect(matchesFilter(items[2], "example.com")).toBe(true);
    expect(matchesFilter(items[2], "archive.org")).toBe(false);
  });

  it("treats an empty/whitespace query as match-all", () => {
    expect(matchesFilter(items[0], "")).toBe(true);
    expect(matchesFilter(items[0], "   ")).toBe(true);
  });

  it("filterItems narrows the list and preserves order", () => {
    const out = filterItems(items, "a"); // appears in all three
    expect(out).toHaveLength(3);
    const sonic = filterItems(items, "sonic");
    expect(sonic.map((i) => i.title)).toEqual(["Sonic the Hedgehog (Europe)"]);
  });

  it("filterItems returns the same array reference for an empty query", () => {
    expect(filterItems(items, "")).toBe(items);
  });
});

// ── resultSort (W172) ────────────────────────────────────────────────────────

describe("resultSort", () => {
  it("found order is the original order (copy, not the same ref)", () => {
    const out = sortItems(items, "found");
    expect(out).not.toBe(items);
    expect(out.map((i) => i.title)).toEqual(items.map((i) => i.title));
  });

  it("sorts title ascending and descending", () => {
    const asc = sortItems(items, "title-asc").map((i) => i.title);
    expect(asc).toEqual([
      "Chrono Trigger (Japan)",
      "Sonic the Hedgehog (Europe)",
      "Super Mario Bros. 3 (USA)",
    ]);
    const desc = sortItems(items, "title-desc").map((i) => i.title);
    expect(desc).toEqual([...asc].reverse());
  });

  it("is stable: equal titles keep original scrape order", () => {
    const dupes = [
      { title: "Game", url: "a" },
      { title: "Game", url: "b" },
      { title: "Game", url: "c" },
    ];
    expect(sortItems(dupes, "title-asc").map((i) => i.url)).toEqual(["a", "b", "c"]);
  });

  it("sorts numerically (natural order)", () => {
    const nums = [
      { title: "Track 10" },
      { title: "Track 2" },
      { title: "Track 1" },
    ];
    expect(sortItems(nums, "title-asc").map((i) => i.title)).toEqual([
      "Track 1",
      "Track 2",
      "Track 10",
    ]);
  });

  it("isSortKey guards untrusted values", () => {
    for (const k of SORT_KEYS) expect(isSortKey(k)).toBe(true);
    expect(isSortKey("bogus")).toBe(false);
  });
});

describe("resultSort persistence", () => {
  beforeEach(() => {
    // jsdom is not enabled for this file; provide a minimal localStorage.
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it("defaults to found when nothing is stored", () => {
    expect(loadSortPref()).toBe("found");
  });

  it("round-trips a saved preference", () => {
    saveSortPref("title-desc");
    expect(loadSortPref()).toBe("title-desc");
  });

  it("ignores a corrupted stored value", () => {
    globalThis.localStorage.setItem("harmony.search.sort", "nonsense");
    expect(loadSortPref()).toBe("found");
  });
});

// ── resultBadges (W174) ──────────────────────────────────────────────────────

describe("resultBadges", () => {
  it("returns nothing for a plain title", () => {
    expect(parseBadges("Some Random Game")).toEqual([]);
  });

  it("parses a region token", () => {
    const b = parseBadges("Super Mario Bros. 3 (USA)");
    expect(b).toContainEqual({ kind: "region", label: "USA", tone: "neutral" });
  });

  it("parses multiple regions without duplicates", () => {
    const labels = parseBadges("Game (USA, Europe)")
      .filter((b) => b.kind === "region")
      .map((b) => b.label);
    expect(labels).toEqual(["USA", "EUR"]);
    expect(parseBadges("Game (USA) (USA)").filter((b) => b.kind === "region")).toHaveLength(1);
  });

  it("parses revision and version", () => {
    expect(parseBadges("Zelda (USA) (Rev A)")).toContainEqual({
      kind: "revision",
      label: "Rev A",
      tone: "neutral",
    });
    expect(parseBadges("Game v1.2")).toContainEqual({
      kind: "revision",
      label: "v1.2",
      tone: "neutral",
    });
  });

  it("parses GoodTools dump-quality markers with tone", () => {
    expect(parseBadges("Game (USA) [!]")).toContainEqual({
      kind: "quality",
      label: "Verified",
      tone: "good",
    });
    expect(parseBadges("Game [b]")).toContainEqual({
      kind: "quality",
      label: "Bad dump",
      tone: "bad",
    });
  });

  it("parses a recognized file extension only", () => {
    expect(parseBadges("Game (USA).zip")).toContainEqual({
      kind: "filetype",
      label: "ZIP",
      tone: "neutral",
    });
    // Not a content extension → no filetype badge.
    expect(parseBadges("Game (USA).html").filter((b) => b.kind === "filetype")).toHaveLength(0);
  });

  it("orders badges region → revision → quality → filetype", () => {
    const kinds = parseBadges("Mario (USA) (Rev A) [!].zip").map((b) => b.kind);
    expect(kinds).toEqual(["region", "revision", "quality", "filetype"]);
  });
});

// ── resultSelection (W173) ───────────────────────────────────────────────────

describe("resultSelection", () => {
  const urls = ["a", "b", "c"];

  it("computes tri-state group selection", () => {
    expect(groupSelectionState(urls, new Set())).toBe("none");
    expect(groupSelectionState(urls, new Set(["a"]))).toBe("some");
    expect(groupSelectionState(urls, new Set(["a", "b", "c"]))).toBe("all");
    expect(groupSelectionState([], new Set())).toBe("none");
  });

  it("toggles a whole group on and off", () => {
    const all = withGroupToggled(urls, new Set());
    expect(groupSelectionState(urls, all)).toBe("all");
    const cleared = withGroupToggled(urls, all);
    expect(groupSelectionState(urls, cleared)).toBe("none");
  });

  it("group toggle from partial selects the rest", () => {
    const out = withGroupToggled(urls, new Set(["a"]));
    expect(groupSelectionState(urls, out)).toBe("all");
  });

  it("toggles a single item without mutating the input", () => {
    const before = new Set(["a"]);
    const after = withItemToggled("b", before);
    expect([...after].sort()).toEqual(["a", "b"]);
    expect(before.has("b")).toBe(false);
    expect(withItemToggled("a", after).has("a")).toBe(false);
  });

  it("confirms only above the threshold", () => {
    expect(needsOpenConfirm(OPEN_CONFIRM_THRESHOLD)).toBe(false);
    expect(needsOpenConfirm(OPEN_CONFIRM_THRESHOLD + 1)).toBe(true);
  });
});
