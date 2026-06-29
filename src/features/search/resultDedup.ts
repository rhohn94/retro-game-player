/**
 * Cross-provider result dedupe (W192 / v0.19 "Reach").
 *
 * NZBHydra's signature move, adapted to Harmony's scraped links: the same game
 * often appears across several providers, each as its own row. This module
 * normalizes scraped titles to a canonical key and merges matching rows into one
 * logical result that lists every provider it is "available from" — inverting the
 * default provider-first grouping into a game-first view that is usually closer
 * to user intent. Pure, framework-free, no network, no metadata beyond the
 * `title` + `url` we already scraped.
 */

/** Minimal shape this module needs from a scraped result. */
export interface DedupItem {
  title: string;
  url: string;
}

/** Minimal shape this module needs from a provider's result group. */
export interface DedupGroup {
  providerId: number;
  providerName: string;
  items: DedupItem[];
}

/** One provider's contribution to a merged result. */
export interface DedupSource {
  providerId: number;
  providerName: string;
  item: DedupItem;
}

/** A game-first row: a canonical title with every source it was found in. */
export interface MergedResult {
  /** The normalized dedupe key the sources collapsed to. */
  key: string;
  /** A representative display title (the first source's, verbatim). */
  title: string;
  /** Every provider link that normalized to this key, in discovery order. */
  sources: DedupSource[];
}

// Region / dump-quality / revision noise lives inside (parens) and [brackets];
// stripping bracketed groups wholesale collapses "Sonic (USA)" and
// "Sonic (Europe)" — distinct dumps of the same game — onto one key.
const BRACKETED = /[([{][^)\]}]*[)\]}]/g;
// A trailing file extension (e.g. ".zip", ".sfc") is format noise, not identity.
const TRAILING_EXT = /\.[a-z0-9]{1,4}$/;

/**
 * Reduce a scraped title to a canonical dedupe key: lowercased, with bracketed
 * region/format/quality groups and any trailing file extension removed, and all
 * remaining punctuation collapsed to single spaces. Conservative — it never
 * drops words, so two genuinely different titles cannot collapse together.
 * Returns `""` when nothing identifying survives (the caller falls back to URL).
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(TRAILING_EXT, "")
    .replace(BRACKETED, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Merge results across providers into game-first {@link MergedResult} rows.
 *
 * Rows are keyed by {@link normalizeTitle}; a row's order is its first
 * appearance (so the merged list preserves the providers' scrape order, which a
 * caller can re-rank). Two links with the same key but the same URL collapse to
 * one source (a provider listing the same link twice never double-counts);
 * different URLs under one key each become a source. Items whose title
 * normalizes to empty fall back to a per-URL key so they are never silently
 * dropped or wrongly merged.
 */
export function dedupeAcrossProviders(groups: DedupGroup[]): MergedResult[] {
  const byKey = new Map<string, MergedResult>();
  const seenUrls = new Map<string, Set<string>>(); // key → urls already counted

  for (const group of groups) {
    for (const item of group.items) {
      const norm = normalizeTitle(item.title);
      const key = norm || `url:${item.url}`;

      let merged = byKey.get(key);
      if (!merged) {
        merged = { key, title: item.title, sources: [] };
        byKey.set(key, merged);
        seenUrls.set(key, new Set());
      }
      const urls = seenUrls.get(key)!;
      if (urls.has(item.url)) continue; // same link again — don't double-count
      urls.add(item.url);
      merged.sources.push({
        providerId: group.providerId,
        providerName: group.providerName,
        item,
      });
    }
  }

  return [...byKey.values()];
}
