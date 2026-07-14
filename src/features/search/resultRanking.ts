/**
 * Relevance ranking for previewed search results (W182 / v0.18 "Focus",
 * quality P0 — title-only match, stopwords, chrome demotion, file-like boost).
 *
 * Pure, framework-free scoring of a scraped result against the structured query
 * (game name + optional console/region tokens). Drives the default "Relevance"
 * sort and the Match badge, and lets the UI demote/hide weak matches.
 */

import {
  contentTerms,
  isFileLike,
  isSiteChrome,
  pathOnly,
  tokens,
} from "./resultChrome";

export { contentTerms, isFileLike, isSiteChrome, tokens } from "./resultChrome";

/** How strongly an item matches the game-name query. */
export type MatchStrength = "strong" | "partial" | "none";

/** The structured query a result is scored against. `console`/`region` are
 *  optional ranking tokens — e.g. `console: "Super Nintendo SNES snes"`,
 *  `region: "USA"` — that boost the score but never gate match strength. */
export interface RankQuery {
  /** The game-name query terms (free text). */
  name: string;
  /** Console tokens to boost (display name + abbreviation + key, space-joined). */
  console?: string;
  /** Region label to boost (e.g. "USA"). */
  region?: string;
}

/** Minimal shape the ranker needs from a result. */
export interface Rankable {
  title: string;
  url: string;
}

/** Region labels offered in the structured-search region select. Mirrors the
 *  regions recognized by {@link parseBadges}; the label is both the dropdown
 *  option and the ranking/compose token. */
export const SEARCH_REGIONS: readonly string[] = [
  "USA", "Europe", "Japan", "World", "UK", "Germany", "France",
  "Spain", "Italy", "Australia", "Korea", "China", "Brazil", "Canada",
];

// Score weights — kept small and explicit so ordering is predictable/testable.
const W_TERM = 10; // per matched name term (title)
const W_FULL = 50; // all name content terms present (dominates partial matches)
const W_PREFIX = 5; // title begins with the first content term
const W_CONSOLE = 8; // a console token appears in the title
const W_REGION = 4; // the region token appears in the title
const W_FILE = 12; // title/path looks like a ROM or archive file
const W_CHROME = -1000; // site navigation — sink below real hits

/** How many of `terms` appear in the title (token or substring). */
function matchedCountInTitle(terms: string[], title: string): number {
  const lower = title.toLowerCase();
  const titleTokens = new Set(tokens(title));
  let n = 0;
  for (const t of terms) {
    if (titleTokens.has(t) || lower.includes(t)) n++;
  }
  return n;
}

/** Score `item` against `query`. Higher = more relevant. Pure.
 *  Name matching uses the **title only** (never the URL query string). */
export function scoreItem(item: Rankable, query: RankQuery): number {
  const nameTerms = contentTerms(query.name);
  if (nameTerms.length === 0) {
    // No content terms — only chrome demotion / file boost apply.
    let score = 0;
    if (isSiteChrome(item, query.name)) score += W_CHROME;
    if (isFileLike(item)) score += W_FILE;
    return score;
  }

  if (isSiteChrome(item, query.name)) {
    return W_CHROME;
  }

  const matched = matchedCountInTitle(nameTerms, item.title);
  let score = matched * W_TERM;
  if (matched === nameTerms.length) score += W_FULL;
  const first = nameTerms[0];
  if (first && item.title.toLowerCase().startsWith(first)) score += W_PREFIX;

  if (query.console) {
    const consoleTokens = tokens(query.console);
    const titleLower = item.title.toLowerCase();
    const titleTok = new Set(tokens(item.title));
    if (consoleTokens.some((t) => titleTok.has(t) || titleLower.includes(t))) {
      score += W_CONSOLE;
    }
  }
  if (query.region) {
    const region = query.region.toLowerCase();
    if (region && item.title.toLowerCase().includes(region)) score += W_REGION;
  }

  if (isFileLike(item)) score += W_FILE;

  // Tiny path bonus (no query string): path segment echoes a content term.
  const path = pathOnly(item.url).toLowerCase();
  if (nameTerms.some((t) => path.includes(t))) score += 2;

  return score;
}

/** Classify how strongly `item` matches the game name — **title only**,
 *  stopwords ignored. Independent of console/region. */
export function matchStrength(item: Rankable, query: RankQuery): MatchStrength {
  const nameTerms = contentTerms(query.name);
  if (nameTerms.length === 0) return "none";
  if (isSiteChrome(item, query.name)) return "none";
  const matched = matchedCountInTitle(nameTerms, item.title);
  if (matched === 0) return "none";
  if (matched === nameTerms.length) return "strong";
  return "partial";
}

/** True when the row is worth showing under default “hide unlikely” — not
 *  chrome and not a total miss on the query. */
export function isLikelyHit(item: Rankable, query: RankQuery): boolean {
  if (isSiteChrome(item, query.name)) return false;
  const terms = contentTerms(query.name);
  if (terms.length === 0) return true;
  return matchStrength(item, query) !== "none";
}

/** Stably order `items` by descending relevance to `query`; ties keep their
 *  original (scrape) order, so this is "Relevance" sort. Pure (returns a new
 *  array). */
export function rankItems<T extends Rankable>(items: T[], query: RankQuery): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, query) }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .map((entry) => entry.item);
}
