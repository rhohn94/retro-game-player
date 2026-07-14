/** Pure result-visibility pipeline shared by the provider and merged (game-first) views. */
import { filterItems } from "../resultFilter";
import { sortItems } from "../resultSort";
import type { SortKey } from "../resultSort";
import {
  rankItems,
  matchStrength,
  scoreItem,
  isSiteChrome,
  isLikelyHit,
} from "../resultRanking";
import type { RankQuery, Rankable } from "../resultRanking";
import { dedupeAcrossProviders } from "../resultDedup";
import type { MergedResult } from "../resultDedup";
import type { SearchResultItem, ProviderResults, LinkState } from "../../../ipc/search";

/** Drop site-chrome rows before ranking / hide-weak. Always applied. */
function dropChrome(items: SearchResultItem[], rankQuery: RankQuery): SearchResultItem[] {
  return items.filter((i) => !isSiteChrome(i, rankQuery.name));
}

/** The single source of truth for which rows of a group are shown, in order:
 *  drop chrome → live filter → order → optional hide-weak. Used both to render
 *  a group and to tally the toolbar totals, so they never diverge. Pure. */
export function computeVisible(
  items: SearchResultItem[],
  filter: string,
  sortKey: SortKey,
  rankQuery: RankQuery,
  hideWeak: boolean
): SearchResultItem[] {
  const cleaned = dropChrome(items, rankQuery);
  const filtered = filterItems(cleaned, filter);
  const ordered =
    sortKey === "relevance"
      ? rankItems(filtered, rankQuery)
      : sortItems(filtered, sortKey);
  return hideWeak
    ? ordered.filter((i) => isLikelyHit(i, rankQuery))
    : ordered;
}

/** Adapt a merged row to the {title, url} shape the ranker/filter/match expect.
 *  Match/score use the representative title (not source URLs) so query strings
 *  on provider links cannot invent a Match badge. */
export function mergedRankable(m: MergedResult): Rankable {
  return { title: m.title, url: m.sources[0]?.item.url ?? "" };
}

/** The game-first analogue of {@link computeVisible}. Pure. */
export function computeMerged(
  results: ProviderResults[],
  filter: string,
  sortKey: SortKey,
  rankQuery: RankQuery,
  hideWeak: boolean
): MergedResult[] {
  // Strip chrome per source before dedupe so nav labels never form a "game".
  const cleaned: ProviderResults[] = results.map((g) => ({
    ...g,
    items: dropChrome(g.items, rankQuery),
  }));
  const merged = dedupeAcrossProviders(cleaned);
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? merged.filter((m) => {
        const r = mergedRankable(m);
        const sourceUrls = m.sources.map((s) => s.item.url).join(" ");
        return `${r.title} ${sourceUrls}`.toLowerCase().includes(q);
      })
    : merged;
  let ordered: MergedResult[];
  if (sortKey === "relevance") {
    ordered = filtered
      .map((m, index) => ({ m, index, score: scoreItem(mergedRankable(m), rankQuery) }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
      .map((e) => e.m);
  } else {
    ordered = sortItems(filtered, sortKey);
  }
  return hideWeak
    ? ordered.filter((m) => isLikelyHit(mergedRankable(m), rankQuery))
    : ordered;
}

/** True when a provider group has at least one likely hit (for collapse seeding). */
export function groupHasLikelyHits(
  group: ProviderResults,
  rankQuery: RankQuery
): boolean {
  return group.items.some((i) => isLikelyHit(i, rankQuery));
}

/** The verdict to show on a merged row that folds several source links: alive if
 *  any source is reachable, dead only if every probed source is dead, else
 *  unknown. Returns undefined until at least one source has been probed. */
export function aggregateState(
  merged: MergedResult,
  statusMap: Map<string, LinkState>
): LinkState | undefined {
  const states = merged.sources
    .map((s) => statusMap.get(s.item.url))
    .filter((s): s is LinkState => s !== undefined);
  if (states.length === 0) return undefined;
  if (states.includes("alive")) return "alive";
  if (states.every((s) => s === "dead")) return "dead";
  return "unknown";
}

// Re-export for callers that only need the badge classifier.
export { matchStrength };
