/**
 * Multi-select helpers (W173 / v0.17 "Sift").
 *
 * Pure selection logic keyed by result URL (the stable per-row identity). The
 * React component holds a `Set<string>` of selected URLs; these helpers compute
 * the tri-state for a group's select-all checkbox, toggle a whole group, and
 * decide when opening many browser tabs warrants a confirm. Framework-free and
 * unit-testable. Opening a link never downloads — it hands the URL to the
 * system browser.
 */

/** A group's select-all state, mirroring a tri-state checkbox. */
export type GroupSelectionState = "none" | "some" | "all";

/** Compute the select-all state for `urls` against the `selected` set. An empty
 *  group is "none" (nothing selectable). */
export function groupSelectionState(
  urls: string[],
  selected: ReadonlySet<string>,
): GroupSelectionState {
  if (urls.length === 0) return "none";
  let count = 0;
  for (const url of urls) if (selected.has(url)) count++;
  if (count === 0) return "none";
  return count === urls.length ? "all" : "some";
}

/** Toggle an entire group: if every url is already selected, deselect them all;
 *  otherwise select them all. Returns a new set (the input is not mutated). */
export function withGroupToggled(
  urls: string[],
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  if (groupSelectionState(urls, selected) === "all") {
    for (const url of urls) next.delete(url);
  } else {
    for (const url of urls) next.add(url);
  }
  return next;
}

/** Toggle a single url. Returns a new set. */
export function withItemToggled(
  url: string,
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  if (next.has(url)) next.delete(url);
  else next.add(url);
  return next;
}

/** Above this many tabs, opening the selection asks for confirmation first. */
export const OPEN_CONFIRM_THRESHOLD = 10;

/** True when opening `count` links should prompt a confirm (too many tabs). */
export function needsOpenConfirm(count: number): boolean {
  return count > OPEN_CONFIRM_THRESHOLD;
}
