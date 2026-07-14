/**
 * Direct unit tests for resultVisibility.ts (coding-practices #60).
 *
 * This module is the composed pipeline behind both the provider-first and
 * game-first result views: filter -> order (relevance rank vs title/scrape
 * sort) -> optional hide-weak, plus the merged-view helpers mergedRankable
 * and aggregateState. Its parts (resultFilter, resultSort, resultRanking,
 * resultDedup) each have their own direct tests; this file exercises the
 * composition itself, since the toolbar totals depend on the exact ordering
 * and hide-weak/dedupe interaction, not just the parts in isolation.
 */
import { describe, it, expect } from "vitest";
import {
  computeVisible,
  computeMerged,
  mergedRankable,
  aggregateState,
} from "./resultVisibility";
import type { RankQuery } from "../resultRanking";
import type { SearchResultItem, ProviderResults, LinkState } from "../../../ipc/search";
import type { MergedResult } from "../resultDedup";

const item = (title: string, url = `https://example.com/${title}`): SearchResultItem => ({
  title,
  url,
});

describe("computeVisible", () => {
  const items: SearchResultItem[] = [
    item("Donkey Kong Country (USA)"),
    item("Mario Paint (Japan)"),
    item("Super Mario Bros. (USA)"),
  ];
  const q: RankQuery = { name: "super mario" };

  it("filters out items that do not match the live filter text", () => {
    const visible = computeVisible(items, "donkey", "relevance", q, false);
    expect(visible.map((i) => i.title)).toEqual(["Donkey Kong Country (USA)"]);
  });

  it("orders by relevance when sortKey is relevance", () => {
    const visible = computeVisible(items, "", "relevance", q, false);
    expect(visible.map((i) => i.title)).toEqual([
      "Super Mario Bros. (USA)",
      "Mario Paint (Japan)",
      "Donkey Kong Country (USA)",
    ]);
  });

  it("orders by title when sortKey is a title sort (not relevance)", () => {
    const visible = computeVisible(items, "", "title-asc", q, false);
    expect(visible.map((i) => i.title)).toEqual([
      "Donkey Kong Country (USA)",
      "Mario Paint (Japan)",
      "Super Mario Bros. (USA)",
    ]);
  });

  it("keeps scrape order when sortKey is found", () => {
    const visible = computeVisible(items, "", "found", q, false);
    expect(visible.map((i) => i.title)).toEqual(items.map((i) => i.title));
  });

  it("hides items with no match at all when hideWeak is true", () => {
    const visible = computeVisible(items, "", "relevance", q, true);
    expect(visible.map((i) => i.title)).toEqual([
      "Super Mario Bros. (USA)",
      "Mario Paint (Japan)",
    ]);
  });

  it("keeps every item when hideWeak is false, even non-matches", () => {
    const visible = computeVisible(items, "", "relevance", q, false);
    expect(visible).toHaveLength(3);
  });

  it("applies filter, order and hide-weak together", () => {
    const visible = computeVisible(items, "mario", "title-asc", q, true);
    expect(visible.map((i) => i.title)).toEqual([
      "Mario Paint (Japan)",
      "Super Mario Bros. (USA)",
    ]);
  });
});

describe("mergedRankable", () => {
  it("folds a single source's url into the {title, url} shape", () => {
    const merged: MergedResult = {
      key: "contra",
      title: "Contra (USA)",
      sources: [{ providerId: 1, providerName: "X", item: item("Contra (USA)", "https://a/contra") }],
    };
    expect(mergedRankable(merged)).toEqual({ title: "Contra (USA)", url: "https://a/contra" });
  });

  it("joins every source url (space-separated) so a url filter still hits", () => {
    const merged: MergedResult = {
      key: "smb3",
      title: "Super Mario Bros. 3 (USA)",
      sources: [
        { providerId: 1, providerName: "A", item: item("SMB3 (USA)", "https://a/smb3") },
        { providerId: 2, providerName: "B", item: item("SMB3 (Europe)", "https://b/smb3") },
      ],
    };
    expect(mergedRankable(merged).url).toBe("https://a/smb3 https://b/smb3");
  });
});

describe("computeMerged", () => {
  const results: ProviderResults[] = [
    {
      providerId: 1,
      providerName: "Internet Archive",
      searchUrl: "https://a/search",
      directDownload: false,
      priority: 30,
      items: [item("Super Mario Bros. 3 (USA)", "https://a/smb3-usa"), item("Sonic (USA)", "https://a/sonic")],
      error: null,
    },
    {
      providerId: 2,
      providerName: "PDRoms",
      searchUrl: "https://b/search",
      directDownload: false,
      priority: 30,
      items: [item("Super Mario Bros 3 (Europe)", "https://b/smb3-eur"), item("Contra", "https://b/contra")],
      error: null,
    },
  ];
  const q: RankQuery = { name: "super mario" };

  it("dedupes the same game across providers into one merged row with every source", () => {
    const merged = computeMerged(results, "", "found", q, false);
    const smb3 = merged.find((m) => m.key === "super mario bros 3");
    expect(smb3).toBeDefined();
    expect(smb3!.sources).toHaveLength(2);
  });

  it("keeps an unfiltered empty query result as the full merged list", () => {
    const merged = computeMerged(results, "", "found", q, false);
    expect(merged).toHaveLength(3);
  });

  it("filters merged rows using the joined title+url haystack", () => {
    const merged = computeMerged(results, "contra", "found", q, false);
    expect(merged.map((m) => m.key)).toEqual(["contra"]);
  });

  it("filters by a source url even when it isn't the display title's own url", () => {
    const merged = computeMerged(results, "smb3-eur", "found", q, false);
    expect(merged.map((m) => m.key)).toEqual(["super mario bros 3"]);
  });

  it("orders by descending relevance score when sortKey is relevance", () => {
    const merged = computeMerged(results, "", "relevance", q, false);
    expect(merged.map((m) => m.key)).toEqual([
      "super mario bros 3",
      "sonic",
      "contra",
    ]);
  });

  it("orders by title when sortKey is a title sort (not relevance)", () => {
    const merged = computeMerged(results, "", "title-asc", q, false);
    expect(merged.map((m) => m.key)).toEqual(["contra", "sonic", "super mario bros 3"]);
  });

  it("hides rows with no match at all when hideWeak is true", () => {
    const merged = computeMerged(results, "", "relevance", q, true);
    expect(merged.map((m) => m.key)).toEqual(["super mario bros 3"]);
  });

  it("returns an empty list when there are no provider results", () => {
    expect(computeMerged([], "", "relevance", q, false)).toEqual([]);
  });
});

describe("aggregateState", () => {
  const merged = (urls: string[]): MergedResult => ({
    key: "k",
    title: "t",
    sources: urls.map((url, i) => ({
      providerId: i,
      providerName: `p${i}`,
      item: item(`t${i}`, url),
    })),
  });

  it("returns undefined when no source has been probed yet", () => {
    const m = merged(["https://a", "https://b"]);
    expect(aggregateState(m, new Map())).toBeUndefined();
  });

  it("is alive when any probed source is alive", () => {
    const m = merged(["https://a", "https://b"]);
    const statusMap = new Map<string, LinkState>([
      ["https://a", "dead"],
      ["https://b", "alive"],
    ]);
    expect(aggregateState(m, statusMap)).toBe("alive");
  });

  it("is dead only when every probed source is dead", () => {
    const m = merged(["https://a", "https://b"]);
    const statusMap = new Map<string, LinkState>([
      ["https://a", "dead"],
      ["https://b", "dead"],
    ]);
    expect(aggregateState(m, statusMap)).toBe("dead");
  });

  it("is unknown when probed sources are mixed dead/unknown with no alive", () => {
    const m = merged(["https://a", "https://b"]);
    const statusMap = new Map<string, LinkState>([
      ["https://a", "dead"],
      ["https://b", "unknown"],
    ]);
    expect(aggregateState(m, statusMap)).toBe("unknown");
  });

  it("ignores sources that have not been probed rather than treating them as dead", () => {
    const m = merged(["https://a", "https://b", "https://c"]);
    // Only "a" has been probed, and it's dead; "b"/"c" are absent from the map.
    const statusMap = new Map<string, LinkState>([["https://a", "dead"]]);
    expect(aggregateState(m, statusMap)).toBe("dead");
  });
});
