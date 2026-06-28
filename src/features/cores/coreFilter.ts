// Pure core browse/search logic (v0.7 "Forge") — React-free so it is unit
// testable. Drives the CoresPage search box + the "browse all systems" view.

import type { Core } from "../../ipc/commands";

/**
 * Flatten the per-system core map into a single ordered list. Known systems in
 * `order` come first (in that order); any others follow alphabetically — so the
 * browse view is stable.
 */
export function flattenCores(
  bySystem: Record<string, Core[]>,
  order: string[],
): Core[] {
  const known = order.filter((s) => s in bySystem);
  const extra = Object.keys(bySystem)
    .filter((s) => !order.includes(s))
    .sort();
  return [...known, ...extra].flatMap((s) => bySystem[s] ?? []);
}

/**
 * Filter cores by a free-text query matching the core id OR the system
 * (case-insensitive substring). An empty query returns the list unchanged.
 */
export function filterCores(cores: Core[], query: string): Core[] {
  const q = query.trim().toLowerCase();
  if (!q) return cores;
  return cores.filter(
    (c) =>
      c.coreId.toLowerCase().includes(q) || c.system.toLowerCase().includes(q),
  );
}

/** Group a flat core list back by system, preserving encounter order. */
export function groupBySystem(cores: Core[]): Record<string, Core[]> {
  const out: Record<string, Core[]> = {};
  for (const c of cores) (out[c.system] ??= []).push(c);
  return out;
}
