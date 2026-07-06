// Typed wrappers for the RetroAchievements account settings commands
// (v0.37 W371 — see docs/design/retroachievements-design.md §Client +
// accounts). Mirrors the shape of ipc/familiar.ts: username is a plain
// persisted field, the Web API key is write-only from the frontend's
// perspective (never read back — it lives only in the macOS Keychain).

import { invoke } from "./invoke";

/** Current RetroAchievements account status, as read by the Settings pane. */
export interface RetroAchievementsAccountStatus {
  /** The persisted username, or `null` if never configured. */
  username: string | null;
  /** Whether a Web API key is currently stored in the Keychain. */
  hasKey: boolean;
}

/** Outcome of validating the configured account against the real API. */
export type RetroAchievementsValidation =
  | { status: "notConfigured" }
  | { status: "valid" }
  | { status: "invalid"; message: string | null };

/**
 * Read the current RetroAchievements account status (username + whether a
 * key is stored). Never touches the network.
 */
export function getRetroAchievementsAccount(): Promise<RetroAchievementsAccountStatus> {
  return invoke<RetroAchievementsAccountStatus>("get_retroachievements_account");
}

/**
 * Persist the RetroAchievements account settings from the Settings screen.
 * `username` of `null` leaves the stored username unchanged; a blank string
 * clears it. `apiKey` of `null` leaves the stored Keychain key untouched,
 * while `""` clears it (never written to disk).
 */
export function saveRetroAchievementsAccount(args: {
  username: string | null;
  apiKey: string | null;
}): Promise<void> {
  return invoke<void>("save_retroachievements_account", {
    username: args.username,
    apiKey: args.apiKey,
  });
}

/**
 * Validate the configured username + Web API key against the real
 * RetroAchievements API. Resolves to `{status: "notConfigured"}` — never
 * rejects — when either half of the credential is absent; the backend makes
 * zero network calls in that case.
 */
export function validateRetroAchievementsAccount(): Promise<RetroAchievementsValidation> {
  return invoke<RetroAchievementsValidation>("validate_retroachievements_account");
}

// --- Unlock experience (v0.37 W372 — retroachievements-design.md
// §Unlock UX + persistence) ---

/** One achievement unlock, display-ready for the in-game overlay toast. */
export interface UnlockToast {
  achievementId: number;
  title: string;
  description: string;
  points: number;
  /** RA badge id (join with RA's badge CDN to render an icon); `null` when
   * the fetched set carried none. */
  badgeName: string | null;
}

/**
 * Drains every unlock the running native session has produced since the
 * last call, persisting each one (idempotently) and returning display-ready
 * toasts for the ones actually seen this call. An empty array is the common
 * case — no session, no RA set armed, or nothing unlocked since the last
 * poll — never an error.
 */
export function pollAchievementUnlocks(): Promise<UnlockToast[]> {
  return invoke<UnlockToast[]>("poll_achievement_unlocks");
}

/** Achievement progress for a game's detail page. */
export interface AchievementSummary {
  unlocked: number;
  total: number;
}

/**
 * Reads the cached achievement summary for `gameId` — `null` when RA has
 * never resolved a set for this game (unconfigured account, unsupported
 * system, or no RA set exists), in which case the detail page shows nothing.
 * Cache-only: never triggers a network fetch of its own.
 */
export function getAchievementSummary(gameId: number): Promise<AchievementSummary | null> {
  return invoke<AchievementSummary | null>("get_achievement_summary", { gameId });
}

// --- Achievement list + badge art (v0.38 W384 —
// retroachievements-design.md §Achievement list) ---

/** One achievement in the detail page's full expandable list. */
export interface AchievementListEntry {
  id: number;
  title: string;
  description: string;
  points: number;
  /** RA badge id, joined with the badge CDN by `getAchievementBadgePath`;
   * `null` when the fetched set carried none. */
  badgeName: string | null;
  /** Unix epoch seconds the achievement was unlocked, or `null` if locked. */
  unlockedAt: number | null;
}

/**
 * Reads the full per-game achievement list for the detail page. Cache-only,
 * exactly like [`getAchievementSummary`] (never triggers a network fetch) —
 * an empty array covers both "no set known for this game" and "set has no
 * achievements", either of which the detail page treats as "hide the
 * section". Ordered unlocked-first, then by points (backend-computed).
 */
export function getAchievementList(gameId: number): Promise<AchievementListEntry[]> {
  return invoke<AchievementListEntry[]>("get_achievement_list", { gameId });
}

/**
 * Resolves `badgeName` to a webview-loadable local file path, fetching
 * (best-effort) and disk-caching the badge art through the backend on a
 * cache miss. `null` when the badge is unavailable for any reason (offline,
 * unrecognized name, an already-known miss this session) — the caller
 * degrades to a neutral placeholder glyph in that case, never a spinner or a
 * retry loop.
 */
export function getAchievementBadgePath(badgeName: string): Promise<string | null> {
  return invoke<string | null>("get_achievement_badge_path", { badgeName });
}
