// Art-source helpers for the library feature (W13).
//
// Cover art and pre-blurred hero bitmaps live on the filesystem. The blurred
// hero arrives as a `data:` URI from the backend (vibrancy.ts), but cover art
// from `metadata`/`Game.artPath` is an absolute filesystem path that the
// webview cannot load directly — it must be funnelled through Tauri's asset
// protocol via `convertFileSrc`. This module centralises that conversion so the
// grid/detail components never touch Tauri APIs directly.

import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Convert an absolute filesystem art path into a webview-loadable asset URL.
 *
 * Returns `null` for empty/null inputs so callers can fall through to the
 * placeholder. `convertFileSrc` is only defined inside the Tauri webview; in a
 * plain browser/test context it throws, so we guard and degrade to `null`.
 */
export function artUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}
