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
