/**
 * Result sorting + persisted preference (W172 / v0.17 "Sift").
 *
 * Pure comparators over scraped preview items plus a tiny localStorage-backed
 * preference store. The sort is stable: ties keep their original scrape order,
 * so "Found" is the identity ordering and the title sorts only reorder on the
 * title key. Framework-free so the comparators are unit-testable in node.
 */

/** The sort orderings offered in the results toolbar. "relevance" (v0.18) is
 *  query-aware and applied by the view via {@link rankItems}, not by
 *  {@link sortItems} (which has no query); the others are title/scrape order. */
export type SortKey = "relevance" | "found" | "title-asc" | "title-desc";

/** All keys, in toolbar order (Relevance leads — it is the default). */
export const SORT_KEYS: readonly SortKey[] = [
  "relevance",
  "found",
  "title-asc",
  "title-desc",
];

/** Human labels for the sort control. */
export const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Relevance",
  found: "Found",
  "title-asc": "Title A→Z",
  "title-desc": "Title Z→A",
};

/** Narrowing guard for an untrusted string (e.g. a persisted value). */
export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

interface Titled {
  title: string;
}

/** Sort `items` by `key`, stably. "found" (and "relevance", which the view
 *  re-orders via `rankItems`) return a shallow copy in the original order; the
 *  title keys compare case- and accent-insensitively with natural numeric
 *  ordering, breaking ties by original index. */
export function sortItems<T extends Titled>(items: T[], key: SortKey): T[] {
  if (key === "found" || key === "relevance") return items.slice();
  const dir = key === "title-asc" ? 1 : -1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const cmp = a.item.title.localeCompare(b.item.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      return cmp !== 0 ? cmp * dir : a.index - b.index;
    })
    .map((entry) => entry.item);
}

// ── Persistence ──────────────────────────────────────────────────────────────

const SORT_PREF_KEY = "rgp.search.sort";

/** W269 rename: legacy pre-rename key, read once as a migration fallback so
 *  an upgrading user's chosen sort order survives. Never written to again. */
const LEGACY_SORT_PREF_KEY = "harmony.search.sort";

/** Load the saved sort preference, defaulting to "relevance" (v0.18) when
 *  absent, invalid, or when localStorage is unavailable (e.g. a non-browser
 *  test env). Falls back to the legacy storage key (W269 rename) if the
 *  current key has never been written. */
export function loadSortPref(): SortKey {
  try {
    const raw = globalThis.localStorage?.getItem(SORT_PREF_KEY);
    if (raw && isSortKey(raw)) return raw;
    const legacy = globalThis.localStorage?.getItem(LEGACY_SORT_PREF_KEY);
    if (legacy && isSortKey(legacy)) return legacy;
  } catch {
    // Ignore storage access errors (private mode, disabled, SSR/test).
  }
  return "relevance";
}

/** Persist the sort preference; a storage failure is swallowed (non-critical). */
export function saveSortPref(key: SortKey): void {
  try {
    globalThis.localStorage?.setItem(SORT_PREF_KEY, key);
  } catch {
    // Ignore storage access errors.
  }
}
