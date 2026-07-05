// Typed wrappers for the SteamGridDB API key settings commands (v0.32 W321
// — see `docs/design/non-retro-library-design.md` §SteamGridDB art (W321)).
// Mirrors the shape of ipc/crt-filter.ts: a single persisted value, get/set
// pair, no domain-specific DTO needed.

import { invoke } from "./invoke";

/**
 * The persisted SteamGridDB API key, or `null` if the user hasn't
 * configured one — the SteamGridDB art-fallback rung is fully inert in that
 * case (scans and shelves behave exactly as before this feature existed).
 */
export function getSteamGridDbApiKey(): Promise<string | null> {
  return invoke<string | null>("get_steamgriddb_api_key");
}

/**
 * Persists the SteamGridDB API key. Passing `null` (or a blank string)
 * clears the setting backend-side.
 */
export function setSteamGridDbApiKey(key: string | null): Promise<void> {
  return invoke<void>("set_steamgriddb_api_key", { key });
}
