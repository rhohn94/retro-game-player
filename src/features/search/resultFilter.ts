/**
 * Live result filtering (W171 / v0.17 "Sift").
 *
 * A pure, framework-free predicate over the scraped preview items: a
 * case-insensitive substring match across the result's title and URL. Kept out
 * of the React component so the logic is unit-testable without a DOM. Operates
 * only on already-scraped `title` + `url` — no fetching, no network.
 */

/** The minimal shape filtering needs (a {@link SearchResultItem} subset). */
export interface FilterableItem {
  title: string;
  url: string;
}

/** True when `item` matches `query` (substring over title + url). An empty or
 *  whitespace-only query matches everything. */
export function matchesFilter(item: FilterableItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)
  );
}

/** Return the items matching `query`, preserving order. Empty query → the same
 *  list (a copy is not made; callers must not mutate). */
export function filterItems<T extends FilterableItem>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => matchesFilter(i, q));
}
