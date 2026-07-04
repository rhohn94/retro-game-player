// Typed wrappers for the non-ROM game-source commands (v0.31 W312/W313
// "Frontier" — see `docs/design/non-retro-library-design.md` §Game sources).
// Each function calls `invoke` with the command name and resolves a typed
// result or throws a typed AppError.

import { invoke } from "./invoke";
import type { GameSource } from "./library";

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

/** A shortlisted-but-unconfirmed game (mirrors Rust `DiscoveredGameDto`). */
export interface DiscoveredGame {
  name: string;
  source: GameSource;
  externalId: string | null;
  launchDescriptor: unknown;
  artHint: string | null;
}

/** A manual-entry target: an app bundle, or an arbitrary executable + args. */
export type ManualTarget =
  | { kind: "app"; bundlePath: string }
  | { kind: "exec"; program: string; args: string[] };

/**
 * Run the `/Applications` + `~/Applications` app scan and return the
 * shortlist. Creates no library rows — the caller must confirm entries via
 * `confirmAppEntries` before anything persists.
 */
export function scanAppSource(): Promise<DiscoveredGame[]> {
  return invoke<DiscoveredGame[]>("scan_app_source");
}

/**
 * Upsert the user-confirmed subset of an app-scan shortlist. Returns the
 * persisted row ids.
 */
export function confirmAppEntries(entries: DiscoveredGame[]): Promise<number[]> {
  return invoke<number[]>("confirm_app_entries", { entries });
}

/**
 * Add a manual library entry: a display name plus an app-bundle or exec
 * target. Returns the persisted row id.
 */
export function addManualEntry(name: string, target: ManualTarget): Promise<number> {
  return invoke<number>("add_manual_entry", { name, target: toWireTarget(target) });
}

/** Convert the camelCase TS `ManualTarget` into the Rust adapter's wire shape
 * (`snake_case` fields under a `kind` tag, matching `#[serde(tag = "kind",
 * rename_all = "snake_case")]` on `ManualTarget`). */
function toWireTarget(target: ManualTarget): Record<string, unknown> {
  if (target.kind === "app") {
    return { kind: "app", bundle_path: target.bundlePath };
  }
  return { kind: "exec", program: target.program, args: target.args };
}
