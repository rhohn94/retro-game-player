// Spatial focus engine (W14, controller-input-design.md §3). A small, dependency-
// free geometric navigation core: given the bounding rects of all focusable
// targets and the current focus, pick the best target in a nav direction. We
// implement this in-repo (rather than vendoring `norigin-spatial-navigation`) to
// avoid a new runtime dependency + lockfile churn; the geometry is the same
// directional nearest-neighbour heuristic. Pure + unit-testable.

import type { SemanticAction } from "./actions";

/** A focusable candidate: a stable id and its viewport rect. */
export interface FocusTarget {
  id: string;
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
}

/** The four navigation directions the spatial engine understands. */
export type NavDirection = "up" | "down" | "left" | "right";

/** Map a semantic nav action to a spatial direction, or null if not a nav move. */
export function navDirection(action: SemanticAction): NavDirection | null {
  switch (action) {
    case "nav_up":
      return "up";
    case "nav_down":
      return "down";
    case "nav_left":
      return "left";
    case "nav_right":
      return "right";
    default:
      return null;
  }
}

function center(r: FocusTarget["rect"]) {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

/**
 * Is `cand` in `dir` relative to `from`? Uses the candidate's center vs. the
 * origin's edge so a target straight ahead always qualifies even with overlap.
 */
function inDirection(from: FocusTarget["rect"], cand: FocusTarget["rect"], dir: NavDirection): boolean {
  const c = center(cand);
  switch (dir) {
    case "up":
      return c.y < from.top;
    case "down":
      return c.y > from.bottom;
    case "left":
      return c.x < from.left;
    case "right":
      return c.x > from.right;
  }
}

/**
 * Directional distance cost: primary-axis travel plus a heavy penalty on
 * cross-axis drift, so navigation prefers the target most aligned with the press
 * (row-major grid feel). Lower is better.
 */
function cost(from: FocusTarget["rect"], cand: FocusTarget["rect"], dir: NavDirection): number {
  const f = center(from);
  const c = center(cand);
  const dx = c.x - f.x;
  const dy = c.y - f.y;
  const CROSS_PENALTY = 2;
  if (dir === "up" || dir === "down") {
    return Math.abs(dy) + Math.abs(dx) * CROSS_PENALTY;
  }
  return Math.abs(dx) + Math.abs(dy) * CROSS_PENALTY;
}

/**
 * Pick the best focus target in `dir` from `currentId`, or null if none lie that
 * way (the caller may then edge-scroll or keep focus). When `currentId` is not
 * among the targets, returns the first target so a fresh screen gains focus.
 */
export function nextFocus(
  targets: ReadonlyArray<FocusTarget>,
  currentId: string | null,
  dir: NavDirection,
): string | null {
  if (targets.length === 0) return null;
  const current = targets.find((t) => t.id === currentId);
  if (!current) return targets[0].id;

  let best: { id: string; cost: number } | null = null;
  for (const t of targets) {
    if (t.id === current.id) continue;
    if (!inDirection(current.rect, t.rect, dir)) continue;
    const c = cost(current.rect, t.rect, dir);
    if (!best || c < best.cost) best = { id: t.id, cost: c };
  }
  return best?.id ?? null;
}
