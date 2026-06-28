// Typed wrappers for the `library` domain (W6/W13). Each function calls `invoke`
// with the command name + camelCase args and resolves a typed return or throws a
// typed AppError. DTOs mirror architecture-design.md §2.1.

import { invoke } from "./invoke";

/** A scanned/identified game row (mirrors Rust `GameDto`). */
export interface Game {
  id: number;
  path: string;
  system: string;
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
