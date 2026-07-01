/** Pure result-visibility pipeline shared by the provider and merged (game-first) views. */
import { filterItems } from "../resultFilter";
import { sortItems } from "../resultSort";
import type { SortKey } from "../resultSort";
import { rankItems, matchStrength, scoreItem } from "../resultRanking";
import type { RankQuery, Rankable } from "../resultRanking";
import { dedupeAcrossProviders } from "../resultDedup";
import type { MergedResult } from "../resultDedup";
import type { SearchResultItem, ProviderResults, LinkState } from "../../../ipc/search";

/** The single source of truth for which rows of a group are shown, in order:
 *  live filter → order (relevance ranking or title/scrape sort) → optional
 *  hide-weak. Used both to render a group and to tally the toolbar totals, so
 *  they never diverge. Pure. */
export function computeVisible(
  items: SearchResultItem[],
  filter: string,
  sortKey: SortKey,
  rankQuery: RankQuery,
  hideWeak: boolean
): SearchResultItem[] {
  const filtered = filterItems(items, filter);
  const ordered =
    sortKey === "relevance"
      ? rankItems(filtered, rankQuery)
      : sortItems(filtered, sortKey);
  return hideWeak
    ? ordered.filter((i) => matchStrength(i, rankQuery) !== "none")
    : ordered;
}

/** Adapt a merged row to the {title, url} shape the ranker/filter/match expect,
 *  folding every source URL into the haystack so a URL filter still hits. */
export function mergedRankable(m: MergedResult): Rankable {
  return { title: m.title, url: m.sources.map((s) => s.item.url).join(" ") };
}

/** The game-first analogue of {@link computeVisible}: dedupe across providers,
 *  then filter → order (relevance ranking or title/scrape sort) → optional
 *  hide-weak. Pure. */
export function computeMerged(
  results: ProviderResults[],
  filter: string,
  sortKey: SortKey,
  rankQuery: RankQuery,
  hideWeak: boolean
): MergedResult[] {
  const merged = dedupeAcrossProviders(results);
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? merged.filter((m) => {
        const r = mergedRankable(m);
        return `${r.title} ${r.url}`.toLowerCase().includes(q);
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
    ? ordered.filter((m) => matchStrength(mergedRankable(m), rankQuery) !== "none")
    : ordered;
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
