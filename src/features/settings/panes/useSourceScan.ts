// useSourceScan — shared scanning-state + status/error reporting for a single
// direct scan-and-upsert game source (Steam/GOG/itch/CrossOver). Extracted in
// W366 from the four near-identical `[name]Scanning` state + `handle[Name]Scan`
// closures in GameSourcesPane.tsx, which all ran the same
// scan → report counts → surface AppError shape.

import { useState } from "react";
import { isAppError } from "../../../ipc/commands";
import type { SourceScanReport } from "../../../ipc/sources";

export interface UseSourceScanResult {
  /** True while this source's scan is in flight. */
  scanning: boolean;
  /** Runs the scan, reporting counts via `onStatus` or an error via `onError`. */
  run: () => Promise<void>;
}

/**
 * Wires one direct-scan source's `scanning` flag and the shared
 * scan → report → surface-error flow. `label` names the source in the status
 * message (e.g. "Steam" → "Steam scan found 3 game(s) — 2 added, 1 updated.").
 */
export function useSourceScan(
  label: string,
  scan: () => Promise<SourceScanReport>,
  onStatus: (message: string) => void,
  onError: (message: string) => void,
): UseSourceScanResult {
  const [scanning, setScanning] = useState(false);

  async function run(): Promise<void> {
    setScanning(true);
    try {
      const report = await scan();
      onStatus(
        `${label} scan found ${report.discovered} game(s) — ${report.added} added, ${report.updated} updated.`,
      );
    } catch (e: unknown) {
      onError(isAppError(e) ? e.detail : String(e));
    } finally {
      setScanning(false);
    }
  }

  return { scanning, run };
}
