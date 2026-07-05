// Typed wrappers for the `familiar` domain (W12). The Familiar is an OPTIONAL,
// AI-backed enrichment service. It is a SOFT dependency: when absent /
// unauthorized / rate-limited / slow, `probeFamiliar` reports
// `present:false`/`authorized:false` (never throws) and the UI simply hides its
// AI affordances. Master contract: architecture-design.md §2.8.

import { invoke } from "./invoke";
import type { GameSource } from "./library";

/**
 * Result of the two-stage Familiar probe. `present` is whether the service
 * responded healthy (stage 1); `authorized` is whether the stored Bearer key
 * validated (stage 2). `capabilities` lists what the Familiar advertises (empty
 * unless `authorized`). The UI shows AI affordances only when `authorized`.
 */
export interface FamiliarProbe {
  present: boolean;
  authorized: boolean;
  baseUrl: string;
  capabilities: string[];
}

// Local structural shape of a game row as returned by `enrichGame`. The
// canonical `Game` DTO is owned by the library domain (W6/W13, `library.ts`);
// this minimal mirror is intentionally NOT exported so the `commands.ts` barrel
// surfaces exactly one `Game` once that module lands.
interface Game {
  id: number;
  // Nullable for non-ROM sources (v0.31 W310) — mirrors the canonical `Game`
  // DTO in `library.ts`.
  path: string | null;
  system: string | null;
  crc32: string | null;
  md5: string | null;
  cleanName: string;
  datMatched: boolean;
  coreHint: string | null;
  artPath: string | null;
  sizeBytes: number;
  addedAt: number;
  /** Game source: `"rom"` (default) or a non-retro source (v0.31 W310).
   * Mirrors the canonical `Game` DTO in `library.ts`. */
  source: GameSource;
  /** JSON launch descriptor for non-`"rom"` sources; `null` for `"rom"` rows
   * (v0.31 W310). Mirrors the canonical `Game` DTO in `library.ts`. */
  launchDescriptor: string | null;
  /** Source-scoped external identifier (e.g. a Steam appid); `null` for
   * `"rom"` rows (v0.31 W310). Mirrors the canonical `Game` DTO in
   * `library.ts`. */
  externalId: string | null;
}

/**
 * Probe the optional Familiar service. Resolves to a `FamiliarProbe` describing
 * present/authorized/capabilities; never rejects on an absent/unauthorized/slow
 * Familiar — the UI keys AI-affordance visibility off `authorized`.
 */
export function probeFamiliar(): Promise<FamiliarProbe> {
  return invoke<FamiliarProbe>("probe_familiar");
}

/**
 * Enrich a game's metadata (fuzzy-title / ambiguous-dump disambiguation) via the
 * Familiar. When the Familiar is absent/unauthorized, resolves to the original
 * game unchanged (silent degrade).
 */
export function enrichGame(gameId: number): Promise<Game> {
  return invoke<Game>("enrich_game", { gameId });
}

/**
 * Persist the Familiar connection settings from the Settings screen. `baseUrl`
 * of `null` leaves the stored URL unchanged; `apiKey` of `null` leaves the
 * stored Keychain key untouched, while `""` clears it (never written to disk).
 */
export function saveFamiliarConfig(args: {
  baseUrl: string | null;
  apiKey: string | null;
}): Promise<void> {
  return invoke<void>("save_familiar_config", { baseUrl: args.baseUrl, apiKey: args.apiKey });
}
