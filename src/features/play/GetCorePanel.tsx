// GetCorePanel — the player slot's "core not installed yet" affordance
// (v0.24 W241): one button that downloads + verifies the system's EmulatorJS
// core, then hands back to the switch to boot in place. RetroArch fallback
// wording keeps it from ever reading as a dead end.

import { useState } from "react";
import { installInPageCore } from "../../ipc/inpage-cores";
import { describeCoreSize } from "./inPageAvailability";

export interface GetCorePanelProps {
  system: string;
  /** Display name of the game's console, e.g. "SNES". */
  systemLabel: string;
  sizeBytes: number;
  /** Called after a verified install — the caller re-resolves and boots. */
  onInstalled: () => void;
}

/** Renders the get-core call to action with inline progress/error states. */
export function GetCorePanel({ system, systemLabel, sizeBytes, onInstalled }: GetCorePanelProps) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = () => {
    setInstalling(true);
    setError(null);
    installInPageCore(system)
      .then(() => onInstalled())
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setInstalling(false));
  };

  return (
    <div className="harmony-getcore" role="status">
      <p className="harmony-getcore__message">
        Play {systemLabel} titles right here — Harmony just needs this console&apos;s
        emulator core once ({describeCoreSize(sizeBytes)}, verified download).
      </p>
      <button
        type="button"
        className="harmony-getcore__button"
        onClick={install}
        disabled={installing}
      >
        {installing ? "Downloading core…" : `Get ${systemLabel} core`}
      </button>
      {error && <p className="harmony-getcore__error">{error}</p>}
      <p className="harmony-getcore__hint">
        Until then, Play launches this game in RetroArch as before.
      </p>
    </div>
  );
}
