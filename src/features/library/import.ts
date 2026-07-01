// Import helpers for the library feature (v0.12).
//
// Two entry points feed the same backend `import_games` pipeline: the native
// file picker (`pickRomFiles`) and drag-and-drop (LibraryPage wires Tauri's
// webview drag-drop events). After import we kick off best-effort metadata
// enrichment (cover art + Wikipedia) per newly added game — fire-and-forget so
// the grid appears immediately.

import { openFileDialog } from "../../ipc/dialog";
import { enrichGameMetadata, importGames } from "../../ipc/commands";
import type { ImportItem } from "../../ipc/commands";

/**
 * ROM file extensions Harmony can identify on import. Mirrors the scan map in
 * `core/library/mapper.rs` (SYSTEMS) — anything else is rejected by the backend.
 */
export const ROM_EXTENSIONS = [
  "nes", "fds", "snes", "smc", "sfc", "n64", "z64", "v64", "a26", "a52", "a78",
  "int", "col", "sms", "md", "gen", "smd", "pce", "neo", "pbp", "j64", "jag",
  "gdi", "cdi", "rvz", "gcm",
];

/**
 * Open the native file picker and return the chosen ROM paths (`[]` when the
 * user cancels). Returns `[]` outside a Tauri webview (tests / headless) so
 * callers never crash.
 */
export async function pickRomFiles(): Promise<string[]> {
  try {
    const selected = await openFileDialog({
      multiple: true,
      directory: false,
      title: "Import games",
      filters: [{ name: "ROMs", extensions: ROM_EXTENSIONS }],
    });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  } catch {
    return [];
  }
}

/** A short human summary of an import batch, for a status line. */
export function summarizeImport(items: ImportItem[]): string {
  const n = (s: ImportItem["status"]) => items.filter((i) => i.status === s).length;
  const parts: string[] = [];
  const imported = n("imported");
  const exists = n("exists");
  const unsupported = n("unsupported");
  const errored = n("error");
  if (imported) parts.push(`${imported} imported`);
  if (exists) parts.push(`${exists} already in library`);
  if (unsupported) parts.push(`${unsupported} unsupported`);
  if (errored) parts.push(`${errored} failed`);
  return parts.length ? parts.join(" · ") : "Nothing to import";
}

/**
 * Import the given file paths, then start best-effort metadata enrichment for
 * each newly imported game. Returns the per-file results immediately (so the
 * grid can show the new games at once). `onEnriched` fires once all enrichment
 * has settled, so the caller can refresh and surface the freshly-fetched art +
 * descriptions.
 */
export async function runImport(
  paths: string[],
  onEnriched?: () => void,
): Promise<ImportItem[]> {
  if (paths.length === 0) return [];
  const results = await importGames(paths);
  const pending = results
    .filter((r) => r.status === "imported" && r.game)
    .map((r) => enrichGameMetadata(r.game!.id).catch(() => undefined));
  if (pending.length > 0 && onEnriched) {
    void Promise.allSettled(pending).then(() => onEnriched());
  }
  return results;
}
