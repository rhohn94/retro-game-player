/**
 * Pick the best downloadable result across provider groups for "Get best match".
 * Prefers: strong match + file-like + directDownload + known-good host + priority.
 */
import type { ProviderResults, SearchResultItem } from "../../ipc/search";
import { isFileLike } from "./resultChrome";
import { matchStrength, scoreItem, type RankQuery } from "./resultRanking";
import { isKnownFileHost } from "./titleAliases";

export interface BestMatchCandidate {
  providerId: number;
  item: SearchResultItem;
  score: number;
}

export function findBestDownloadMatch(
  groups: ProviderResults[],
  rankQuery: RankQuery,
): BestMatchCandidate | null {
  let best: BestMatchCandidate | null = null;
  for (const g of groups) {
    if (!g.directDownload || g.error) continue;
    const prioBoost = Math.max(0, 40 - (g.priority ?? 100));
    for (const item of g.items) {
      const strength = matchStrength(item, rankQuery);
      if (strength === "none") continue;
      let s = scoreItem(item, rankQuery) + prioBoost;
      if (strength === "strong") s += 30;
      if (isFileLike(item)) s += 25;
      if (isKnownFileHost(item.url)) s += 20;
      if (!best || s > best.score) {
        best = { providerId: g.providerId, item, score: s };
      }
    }
  }
  return best;
}

/** Map selected URLs to downloadable (providerId, url, title) triples. */
export function downloadableSelection(
  groups: ProviderResults[],
  selectedUrls: Set<string>,
): { providerId: number; url: string; title: string }[] {
  const out: { providerId: number; url: string; title: string }[] = [];
  for (const g of groups) {
    if (!g.directDownload) continue;
    for (const item of g.items) {
      if (selectedUrls.has(item.url)) {
        out.push({ providerId: g.providerId, url: item.url, title: item.title });
      }
    }
  }
  return out;
}
