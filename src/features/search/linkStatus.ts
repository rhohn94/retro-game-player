/**
 * Link-liveness display helpers (W193 / v0.19 "Reach").
 *
 * Pure presentation logic over the backend's {@link LinkStatus} verdicts: a tiny
 * status → dot/colour/label mapping and a url → state lookup map. Framework-free
 * so the mapping is unit-testable in node; the React wiring lives in SearchPage.
 * The probe itself (the `HEAD` request) is the backend's job — this only renders
 * what it returned.
 */

import type { LinkState, LinkStatus } from "../../ipc/search";

/** How a liveness state is shown: a coloured dot + a human label. */
export interface StatusIndicator {
  /** A small glyph for the status dot. */
  symbol: string;
  /** An Aura colour token for the dot. */
  color: string;
  /** A short, human-readable label (tooltip / aria). */
  label: string;
}

const INDICATORS: Record<LinkState, StatusIndicator> = {
  alive: { symbol: "●", color: "var(--aura-success)", label: "Link is reachable" },
  dead: { symbol: "●", color: "var(--aura-error)", label: "Link appears dead (404)" },
  unknown: {
    symbol: "●",
    color: "var(--aura-on-surface-muted)",
    label: "Liveness unknown (blocked or unreachable)",
  },
};

/** Map a liveness state to its display indicator. Pure. */
export function statusIndicator(state: LinkState): StatusIndicator {
  return INDICATORS[state];
}

/** Build a url → state lookup from a probe response, for O(1) per-row lookup. */
export function buildStatusMap(statuses: LinkStatus[]): Map<string, LinkState> {
  const map = new Map<string, LinkState>();
  for (const s of statuses) map.set(s.url, s.state);
  return map;
}
