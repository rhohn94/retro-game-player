/**
 * Tests for resultRanking + resultChrome (W182 + search-result-quality P0).
 */
import { describe, it, expect } from "vitest";
import {
  scoreItem,
  matchStrength,
  rankItems,
  SEARCH_REGIONS,
  isSiteChrome,
  isFileLike,
  contentTerms,
} from "./resultRanking";
import type { RankQuery } from "./resultRanking";

const item = (title: string, url = "https://x.example.com/" + encodeURIComponent(title)) => ({
  title,
  url,
});

describe("contentTerms / stopwords", () => {
  it("drops the/a/of from the query", () => {
    expect(contentTerms("Sonic the Hedgehog")).toEqual(["sonic", "hedgehog"]);
  });
});

describe("scoreItem", () => {
  it("scores a full-coverage match above a partial one", () => {
    const q: RankQuery = { name: "super mario" };
    const full = scoreItem(item("Super Mario Bros. (USA)"), q);
    const partial = scoreItem(item("Mario Paint"), q);
    const none = scoreItem(item("Donkey Kong Country"), q);
    expect(full).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(none);
    expect(none).toBe(0);
  });

  it("returns 0 when the query name has no terms", () => {
    expect(scoreItem(item("Anything"), { name: "   " })).toBe(0);
  });

  it("adds a console bonus when a console token appears in the title", () => {
    const base: RankQuery = { name: "zelda" };
    const withConsole: RankQuery = { name: "zelda", console: "Nintendo 64 N64 n64" };
    const it1 = item("Legend of Zelda (N64)");
    expect(scoreItem(it1, withConsole)).toBeGreaterThan(scoreItem(it1, base));
  });

  it("adds a region bonus when the region appears in the title", () => {
    const base: RankQuery = { name: "contra" };
    const withRegion: RankQuery = { name: "contra", region: "USA" };
    const it1 = item("Contra (USA)");
    expect(scoreItem(it1, withRegion)).toBeGreaterThan(scoreItem(it1, base));
  });

  it("matches a term as a substring in the title (supermario contains mario)", () => {
    expect(scoreItem(item("supermario.zip"), { name: "mario" })).toBeGreaterThan(0);
  });

  it("does not treat URL query string as title evidence for chrome rows", () => {
    const q: RankQuery = { name: "Sonic the Hedgehog" };
    const chrome = item("Home", "https://roms.example/search?q=Sonic+the+Hedgehog");
    expect(matchStrength(chrome, q)).toBe("none");
    expect(scoreItem(chrome, q)).toBeLessThan(0);
  });

  it("boosts file-like titles", () => {
    const q: RankQuery = { name: "sonic" };
    const file = scoreItem(item("Sonic (USA).zip"), q);
    const page = scoreItem(item("Sonic (USA)"), q);
    expect(file).toBeGreaterThan(page);
  });
});

describe("matchStrength", () => {
  const q: RankQuery = { name: "super mario" };

  it("is strong when all content terms are present in the title", () => {
    expect(matchStrength(item("Super Mario Bros. 3 (USA)"), q)).toBe("strong");
  });

  it("is partial when only some name terms are present", () => {
    expect(matchStrength(item("Mario Paint"), q)).toBe("partial");
  });

  it("is none when no name terms are present", () => {
    expect(matchStrength(item("Donkey Kong Country"), q)).toBe("none");
  });

  it("is none for an empty query name", () => {
    expect(matchStrength(item("Whatever"), { name: "" })).toBe("none");
  });

  it("does not gate on console/region (title without console is still strong)", () => {
    const withConsole: RankQuery = { name: "mario", console: "SNES snes" };
    expect(matchStrength(item("Mario Bros. (USA)"), withConsole)).toBe("strong");
  });

  it("ignores stopword 'the' so Sonic the Hedgehog matches Sonic Hedgehog titles", () => {
    const sonic: RankQuery = { name: "Sonic the Hedgehog" };
    expect(matchStrength(item("Sonic Hedgehog (USA)"), sonic)).toBe("strong");
    expect(matchStrength(item("Sonic the Hedgehog"), sonic)).toBe("strong");
  });

  it("marks nav labels as none even when the URL carries the query", () => {
    const sonic: RankQuery = { name: "Sonic the Hedgehog" };
    expect(
      matchStrength(item("ROMs", "https://x.com/?s=Sonic+the+Hedgehog"), sonic)
    ).toBe("none");
    expect(
      matchStrength(item("En", "https://wowroms.com/en/roms/list?search=Sonic"), sonic)
    ).toBe("none");
  });

  it("expands short aliases so oot matches Ocarina of Time titles (Phase 4)", () => {
    const oot: RankQuery = { name: "oot" };
    expect(
      matchStrength(item("The Legend of Zelda: Ocarina of Time (USA)"), oot)
    ).toBe("strong");
  });
});

describe("known file host boost (Phase 4)", () => {
  it("boosts archive.org over an unknown host for the same title", () => {
    const q: RankQuery = { name: "sonic" };
    const archive = scoreItem(
      item("Sonic", "https://archive.org/details/sonic"),
      q
    );
    const other = scoreItem(item("Sonic", "https://example.com/sonic"), q);
    expect(archive).toBeGreaterThan(other);
  });
});

describe("isSiteChrome / isFileLike", () => {
  it("flags common nav titles", () => {
    expect(isSiteChrome(item("ROMs"), "sonic")).toBe(true);
    expect(isSiteChrome(item("Emulators"), "sonic")).toBe(true);
    expect(isSiteChrome(item("Nintendo DS"), "sonic")).toBe(true);
    expect(isSiteChrome(item("Super Nintendo"), "sonic")).toBe(true);
  });

  it("keeps titles that include a content query term", () => {
    expect(isSiteChrome(item("Sonic ROMs pack"), "Sonic the Hedgehog")).toBe(false);
  });

  it("detects file-like extensions", () => {
    expect(isFileLike(item("game.zip"))).toBe(true);
    expect(isFileLike(item("Sonic.md"))).toBe(true);
    expect(isFileLike(item("Home"))).toBe(false);
  });
});

describe("rankItems", () => {
  it("orders by descending relevance, strong matches first", () => {
    const items = [
      item("Donkey Kong Country (USA)"),
      item("Mario Paint (Japan)"),
      item("Super Mario Bros. (USA)"),
    ];
    const ranked = rankItems(items, { name: "super mario" });
    expect(ranked.map((r) => r.title)).toEqual([
      "Super Mario Bros. (USA)",
      "Mario Paint (Japan)",
      "Donkey Kong Country (USA)",
    ]);
  });

  it("is stable: equal scores keep original order", () => {
    const items = [item("Mario A"), item("Mario B"), item("Mario C")];
    const ranked = rankItems(items, { name: "mario" });
    expect(ranked.map((r) => r.title)).toEqual(["Mario A", "Mario B", "Mario C"]);
  });

  it("returns a new array without mutating the input", () => {
    const items = [item("b"), item("a")];
    const copy = [...items];
    rankItems(items, { name: "a" });
    expect(items).toEqual(copy);
  });

  it("sinks chrome below real hits for Sonic-like scrapes", () => {
    const items = [
      item("ROMs"),
      item("Emulators"),
      item("Sonic the Hedgehog (USA)"),
      item("Tags"),
    ];
    const ranked = rankItems(items, { name: "Sonic the Hedgehog" });
    expect(ranked[0].title).toBe("Sonic the Hedgehog (USA)");
  });
});

describe("SEARCH_REGIONS", () => {
  it("offers the common regions", () => {
    expect(SEARCH_REGIONS).toContain("USA");
    expect(SEARCH_REGIONS).toContain("Japan");
    expect(SEARCH_REGIONS).toContain("Europe");
  });
});
