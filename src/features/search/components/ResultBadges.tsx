/** Small badge/indicator chips shown on result rows: title-parsed badges, the
 *  relevance match chip, and the liveness dot. */
import type { Badge } from "../resultBadges";
import type { MatchStrength } from "../resultRanking";
import { statusIndicator } from "../linkStatus";
import type { LinkState } from "../../../ipc/search";

/** Tone → colour for a parsed badge chip. */
export function badgeColor(tone: Badge["tone"]): string {
  if (tone === "good") return "var(--aura-success)";
  if (tone === "bad") return "var(--aura-error)";
  return "var(--aura-on-surface-muted)";
}

/** A relevance "Match"/"Partial" chip (v0.18) — indicates that a row matches
 *  the searched-for game. `none`-strength rows render nothing. */
export function MatchBadge({ strength }: { strength: MatchStrength }) {
  if (strength === "none") return null;
  const strong = strength === "strong";
  const color = strong ? "var(--aura-primary)" : "var(--aura-on-surface-muted)";
  return (
    <span
      title={strong ? "Strong match for your search" : "Partial match for your search"}
      style={{
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        background: strong ? "var(--harmony-provider-enabled-bg)" : "transparent",
        color,
        flexShrink: 0,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {strong ? "✓ Match" : "~ Partial"}
    </span>
  );
}

/** A small liveness dot (v0.19) — green alive / red dead / grey unknown. Renders
 *  nothing until the link has been probed (`state` undefined = not checked). */
export function LivenessDot({ state }: { state: LinkState | undefined }) {
  if (!state) return null;
  const ind = statusIndicator(state);
  return (
    <span
      role="img"
      aria-label={ind.label}
      title={ind.label}
      style={{ color: ind.color, fontSize: 10, lineHeight: 1, flexShrink: 0 }}
    >
      {ind.symbol}
    </span>
  );
}

/** A compact chip for a title-parsed badge (region / revision / quality / type). */
export function BadgeChip({ badge }: { badge: Badge }) {
  const color = badgeColor(badge.tone);
  return (
    <span
      title={badge.kind}
      style={{
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        color,
        flexShrink: 0,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {badge.label}
    </span>
  );
}
