// Typed wrappers for the `console` catalog domain (v0.12). Each function calls
// `invoke` with camelCase args and resolves a typed return. DTOs mirror the Rust
// `ConsoleDto` / `CatalogPageDto` in `commands/console.rs`.

import { invoke } from "./invoke";

/** A console with static facts, cached media, and ownership/catalog counts. */
export interface ConsoleInfo {
  /** Canonical system key (matches `Game.system`). */
  key: string;
  /** Full display name. */
  name: string;
  /** Manufacturer. */
  manufacturer: string;
  /** Short tag / abbreviation. */
  abbreviation: string;
  /** Console generation (2–6). */
  generation: number;
  /** Debut year. */
  year: number;
  /** Main CPU (chip + clock). */
  cpu: string;
  /** Graphics processor / video chip. */
  gpu: string;
  /** Main system RAM (display string — units vary across the retro era). */
  ram: string;
  /** Wikipedia summary text, if fetched/cached (null until then). */
  description: string | null;
  /** Canonical Wikipedia article URL, if cached. */
  wikipediaUrl: string | null;
  /** On-disk path to the cached console photo, if any. */
  imagePath: string | null;
  /** How many games the user owns for this console. */
  ownedCount: number;
  /** How many distinct titles the bundled catalog knows for this console. */
  catalogCount: number;
}

/** One bundled catalog title with an ownership flag. */
export interface CatalogTitle {
  title: string;
  /** True when the user's library has a matching game. */
  owned: boolean;
}

/** A page of a console's title catalog. */
export interface CatalogPage {
  system: string;
  /** Total titles matching the query (the full set when no query). */
  total: number;
  offset: number;
  items: CatalogTitle[];
}

/**
 * List every console with whatever media is already cached (no network call).
 * Render the grid immediately, then call `getConsole` to fill in missing photos.
 */
export function listConsoles(): Promise<ConsoleInfo[]> {
  return invoke<ConsoleInfo[]>("list_consoles");
}

/**
 * Fetch one console, downloading + caching its Wikipedia photo + description on
 * first access (best-effort — a miss leaves media null).
 */
export function getConsole(key: string): Promise<ConsoleInfo> {
  return invoke<ConsoleInfo>("get_console", { key });
}

/**
 * Browse a console's bundled title catalog with an optional case-insensitive
 * search and pagination. Each title is flagged `owned` when the user has it.
 */
export function listCatalogTitles(
  system: string,
  query: string | undefined,
  offset: number,
  limit: number,
): Promise<CatalogPage> {
  return invoke<CatalogPage>("list_catalog_titles", { system, query, offset, limit });
}
