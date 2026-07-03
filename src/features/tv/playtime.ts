// Play-time / last-played formatting for the TV hero chip (v0.26 W261,
// tv-mode-design.md §Design "Hero": "play-time/last-played chip when present").
// Pure + framework-free so the human-readable strings are unit-testable without
// a clock or a DOM. The backend measures durations; this only formats.

/**
 * Format a cumulative play duration (milliseconds) as a compact, distance-
 * legible label — "45m", "3h 20m", "12h". Sub-minute durations round up to
 * "1m" (a played game is never "0m" on the hero). Returns null for a
 * never-played game (0 / negative) so the caller omits the play-time chip.
 */
export function formatPlayTime(totalMs: number): string | null {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  const totalMinutes = Math.max(1, Math.round(totalMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** One second, in ms — the unit the recency buckets are derived from. */
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Format a last-played timestamp (unix SECONDS, matching `Game.lastPlayedAt`)
 * relative to `nowMs` (unix MILLISECONDS) as a coarse, glanceable label:
 * "Just now", "Today", "Yesterday", "N days ago", "N weeks ago", else a
 * "MON YYYY" month/year. Returns null when `lastPlayedAt` is null (never
 * played) so the caller omits the chip.
 *
 * Coarse-by-design: at 10 feet the exact minute is noise; the user wants
 * "have I touched this recently?" not a precise timestamp.
 */
export function formatLastPlayed(
  lastPlayedAtSec: number | null,
  nowMs: number,
): string | null {
  if (lastPlayedAtSec == null) return null;
  const thenMs = lastPlayedAtSec * SECOND_MS;
  const deltaMs = nowMs - thenMs;

  // A clock skew (future timestamp) or a play within the last minute both read
  // as "Just now" rather than a confusing negative/"0 days ago".
  if (deltaMs < MINUTE_MS) return "Just now";
  if (deltaMs < HOUR_MS) {
    const mins = Math.floor(deltaMs / MINUTE_MS);
    return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  }
  if (deltaMs < DAY_MS) {
    const hours = Math.floor(deltaMs / HOUR_MS);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const days = Math.floor(deltaMs / DAY_MS);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  // Older than a month: show the month + year so it's still meaningful.
  const date = new Date(thenMs);
  const month = date.toLocaleString("en-US", { month: "short" });
  return `${month} ${date.getFullYear()}`;
}

/**
 * Compose the hero's metadata subtitle line from a game's system label and
 * release year: "SNES · 1991", or just "SNES" when the year is unknown. Pure so
 * the hero's line is one testable string, not ad-hoc JSX concatenation.
 */
export function heroMetaLine(systemLabel: string, year: number | null): string {
  return year != null ? `${systemLabel} · ${year}` : systemLabel;
}
