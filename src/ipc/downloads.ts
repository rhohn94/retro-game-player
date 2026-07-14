// Direct-download IPC (v0.24 W244, #30): start/cancel a user-initiated
// download from a direct_download-enabled provider, discard staged
// unrecognized files, and subscribe to the backend's progress/done events.

import { invoke } from "./invoke";

/** `download://progress` payload. */
export interface DownloadProgress {
  id: number;
  received: number;
  total?: number;
}

/** `download://done` payload — exactly one of gameId/stagedPath/error. */
export interface DownloadDone {
  id: number;
  gameId?: number;
  alreadyPresent?: boolean;
  /** Library path of the imported file (Reveal-in-Finder). */
  filePath?: string;
  stagedPath?: string;
  error?: string;
}

/** Starts a download; resolves to the id progress/done events carry. */
export function startDownload(providerId: number, url: string): Promise<number> {
  return invoke<number>("start_download", { providerId, url });
}

/** Cancels a running download (no-op for finished ids). */
export function cancelDownload(id: number): Promise<void> {
  return invoke<void>("cancel_download", { id });
}

/** Deletes a staged unrecognized download (staging-dir paths only). */
export function discardStagedDownload(path: string): Promise<void> {
  return invoke<void>("discard_staged_download", { path });
}

/**
 * Subscribes to download events. Returns an unsubscribe function. Outside
 * Tauri (mock/browser) this resolves to a no-op — events simply never fire.
 */
export async function onDownloadEvents(handlers: {
  progress?: (e: DownloadProgress) => void;
  done?: (e: DownloadDone) => void;
}): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unsubs = await Promise.all([
      handlers.progress
        ? listen<DownloadProgress>("download://progress", (e) => handlers.progress?.(e.payload))
        : Promise.resolve(() => undefined),
      handlers.done
        ? listen<DownloadDone>("download://done", (e) => handlers.done?.(e.payload))
        : Promise.resolve(() => undefined),
    ]);
    return () => unsubs.forEach((u) => u());
  } catch {
    return () => undefined;
  }
}
