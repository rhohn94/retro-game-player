// Typed wrappers for the non-ROM game-source scan commands (v0.31 W312
// "Frontier" — see `docs/design/non-retro-library-design.md` §Game sources).
// Each function calls `invoke` with the command name and resolves a typed
// summary report or throws a typed AppError.

import { invoke } from "./invoke";

/**
 * Summary of one game-source scan (mirrors Rust `SourceScanReportDto`).
 */
export interface SourceScanReport {
  /** Total games the scanner found. */
  discovered: number;
  /** Newly inserted library rows. */
  added: number;
  /** Existing library rows refreshed by this scan. */
  updated: number;
}

/**
 * Scan the local Steam installation for installed games (parses
 * `appmanifest_*.acf` manifests; no network calls) and upsert each into the
 * library. Returns a `{ discovered, added, updated }` summary. A machine
 * without Steam installed yields `discovered: 0`, not an error.
 */
export function scanSteamSource(): Promise<SourceScanReport> {
  return invoke<SourceScanReport>("scan_steam_source");
}
