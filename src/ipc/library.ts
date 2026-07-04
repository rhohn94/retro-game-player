// Typed wrappers for the `library` domain (W6/W13). Each function calls `invoke`
// with the command name + camelCase args and resolves a typed return or throws a
// typed AppError. DTOs mirror architecture-design.md §2.1.

import { invoke } from "./invoke";

/**
 * A game's source (mirrors Rust `GameSource`, v0.31 W310 "Frontier" — see
 * `docs/design/non-retro-library-design.md`). `"rom"` is the pre-v0.31
 * default; the others are non-retro library rows that launch externally via
 * a `launchDescriptor` rather than through a ROM + core.
 */
export type GameSource = "rom" | "steam" | "app" | "manual";

/** A scanned/identified game row (mirrors Rust `GameDto`). */
export interface Game {
  id: number;
  /** ROM path; `null` for non-ROM sources (v0.31 W310). */
  path: string | null;
  /** Emulated system; `null` for non-ROM sources (v0.31 W310). */
  system: string | null;
  crc32: string | null;
  md5: string | null;
  cleanName: string;
  datMatched: boolean;
  coreHint: string | null;
  artPath: string | null;
  sizeBytes: number;
  addedAt: number;
  /** Release year, if known (null until enrichment populates it). */
  year: number | null;
  /** Developer / studio, if known. */
  developer: string | null;
  /** Publisher, if known. */
  publisher: string | null;
  /** Alternate titles / popular aliases (empty when none). */
  aliases: string[];
  /** Wikipedia summary text, if fetched (null until enrichment populates it). */
  description: string | null;
  /** Canonical Wikipedia article URL, if known. */
  wikipediaUrl: string | null;
  /** User-toggled favorite flag (v0.26 "library life"). */
  favorite: boolean;
  /** Unix epoch seconds of the most recent play session's end, or null if
   * the game has never been played (v0.26 "library life"). */
  lastPlayedAt: number | null;
  /** Number of completed play sessions (v0.26 "library life"). */
  playCount: number;
  /** Cumulative server-measured play time, in milliseconds (v0.26 "library
   * life"). */
  totalPlayTimeMs: number;
  /** Game source: `"rom"` (default) or a non-retro source (v0.31 W310). */
  source: GameSource;
  /** JSON launch descriptor for non-`"rom"` sources; `null` for `"rom"` rows
   * (v0.31 W310). */
  launchDescriptor: string | null;
  /** Source-scoped external identifier (e.g. a Steam appid); `null` for
   * `"rom"` rows (v0.31 W310). */
  externalId: string | null;
}

/** Per-file outcome of an import (mirrors Rust `ImportItemDto`). */
export interface ImportItem {
  /** The source path the user supplied. */
  source: string;
  /** Outcome: newly added, already present, wrong file type, or failed. */
  status: "imported" | "exists" | "unsupported" | "error";
  /** The resulting game (present for `imported` and `exists`). */
  game: Game | null;
  /** Human-readable detail for `unsupported` / `error`. */
  message: string | null;
}

/** A configured content folder (mirrors Rust `ContentFolderDto`). */
export interface ContentFolder {
  id: number;
  path: string;
  enabled: boolean;
  addedAt: number;
}

/** Summary returned by a folder scan / rescan (mirrors Rust `ScanReport`). */
export interface ScanReport {
  folderId: number;
  scanned: number;
  identified: number;
  unidentified: number;
  added: number;
}

/** Add a content folder to the library; returns the persisted row. */
export function addContentFolder(path: string): Promise<ContentFolder> {
  return invoke<ContentFolder>("add_content_folder", { path });
}

/** List every configured content folder. */
export function listContentFolders(): Promise<ContentFolder[]> {
  return invoke<ContentFolder[]>("list_content_folders");
}

/** Remove a content folder (cascades to its games). */
export function removeContentFolder(id: number): Promise<void> {
  return invoke<void>("remove_content_folder", { id });
}

/** Scan a single content folder by id; returns the scan summary. */
export function scanFolder(id: number): Promise<ScanReport> {
  return invoke<ScanReport>("scan_folder", { id });
}

/** Rescan every enabled content folder; returns a combined summary. */
export function rescan(): Promise<ScanReport> {
  return invoke<ScanReport>("rescan");
}

/** List games, optionally filtered by system. */
export function listGames(system?: string): Promise<Game[]> {
  return invoke<Game[]>("list_games", { system });
}

/** Fetch a single game by id. */
export function getGame(id: number): Promise<Game> {
  return invoke<Game>("get_game", { id });
}

/**
 * Import one or more ROM files into the library: each is identified by
 * extension, copied into the configured Games directory, and registered.
 * Returns a per-file result so the caller can report imported / already-present
 * / unsupported / failed. Enrich each imported game separately via
 * `enrichGameMetadata` for cover art + a Wikipedia description (v0.12).
 */
export function importGames(sources: string[]): Promise<ImportItem[]> {
  return invoke<ImportItem[]>("import_games", { sources });
}

/**
 * Suggest (without creating) the default games-directory path so the confirm
 * dialog can pre-fill it. Returns an absolute path string (W51).
 */
export function suggestGamesDir(): Promise<string> {
  return invoke<string>("suggest_games_dir");
}

/**
 * Create a games directory at the (user-confirmed) location and persist it to
 * config. Creation is idempotent and refuses unsafe targets; an empty/omitted
 * path uses the default `~/Games`. Returns the absolute path created (W51).
 */
export function createGamesFolder(suggestedPath?: string): Promise<string> {
  return invoke<string>("create_games_folder", { suggestedPath });
}
