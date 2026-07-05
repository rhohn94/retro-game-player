// GameSourcesPane — the Settings "Game sources" section (v0.31 W313; GOG +
// itch added v0.32 W320; SteamGridDB API key field added v0.32 W321;
// CrossOver added v0.33 W331).
//
// Seven affordances, per docs/design/non-retro-library-design.md §UI (and
// crossover-integration-design.md §Enumeration for CrossOver):
// - Steam: trigger a re-scan (button calls scan_steam_source; W312).
// - Apps: run the /Applications + ~/Applications scan, then confirm a
//   checklist of the shortlist before any row is created (no silent library
//   flooding — see the design doc's confirm-gate requirement).
// - GOG: trigger a re-scan (button calls scan_gog_source; W320).
// - itch: trigger a re-scan (button calls scan_itch_source; W320).
// - CrossOver: trigger a re-scan (button calls scan_crossover_source; W331).
// - Manual: a name + file-picker form that adds an escape-hatch entry.
// - SteamGridDB: an API key field for the art-fallback rung that covers
//   non-Steam titles (apps, manual, GOG, itch, CrossOver). Blank/absent
//   leaves the provider fully inert — scans and shelves behave exactly as
//   v0.31 (§Art & metadata, W321).
//
// GOG/itch/CrossOver mirror Steam exactly (an unconfirmed direct
// scan-and-upsert, no shortlist) rather than the Apps confirm-gate shape,
// since all three are scoped installs (a Galaxy/itch/bottle-owned tree)
// rather than a broad system scan that could pick up non-games. Each direct
// source's scan/status/error plumbing is shared via `useSourceScan`; the
// per-source row markup is shared via `ScanSourceRow`. The Apps, Manual entry,
// and SteamGridDB sections each own their own file (AppsSourceSection.tsx,
// ManualEntrySection.tsx, SteamGridDbSection.tsx) to keep this file to its
// orchestration role (W366).
//
// Aura note: buttons fire native `click`, so this file uses React `onClick`
// throughout (never a Grimoire `aura-click` listener); `AuraField` wraps a
// contained `<input>` and never takes `value`/`type` props itself.

import { useCallback, useEffect, useState } from "react";

import {
  addManualEntry,
  confirmAppEntries,
  scanAppSource,
  scanCrossoverSource,
  scanGogSource,
  scanItchSource,
  scanSteamSource,
  type DiscoveredGame,
  type ManualTarget,
} from "../../../ipc/sources";
import { getSteamGridDbApiKey, setSteamGridDbApiKey } from "../../../ipc/steamgriddb";
import { openFileDialog } from "../../../ipc/dialog";
import { isAppError } from "../../../ipc/commands";
import { manualNameError, manualTargetError, selectChecked } from "./gameSourcesGating";
import { useSourceScan } from "./useSourceScan";
import { ScanSourceRow } from "./ScanSourceRow";
import { AppsSourceSection, type ShortlistRow } from "./AppsSourceSection";
import { ManualEntrySection } from "./ManualEntrySection";
import { SteamGridDbSection } from "./SteamGridDbSection";

/** One direct scan-and-upsert source's static row text. */
interface DirectSourceCopy {
  title: string;
  description: string;
  scanLabel: string;
}

const DIRECT_SOURCES: Record<"steam" | "gog" | "itch" | "crossover", DirectSourceCopy> = {
  steam: {
    title: "Steam",
    description: "Scans installed Steam titles from your local Steam library.",
    scanLabel: "Scan Steam library",
  },
  gog: {
    title: "GOG",
    description: "Scans installed GOG Galaxy titles from your local GOG library.",
    scanLabel: "Scan GOG library",
  },
  itch: {
    title: "itch",
    description: "Scans installed itch titles from your local itch app installs.",
    scanLabel: "Scan itch library",
  },
  crossover: {
    title: "CrossOver",
    description: "Scans installed CrossOver bottles for their Windows applications.",
    scanLabel: "Scan CrossOver bottles",
  },
};

export function GameSourcesPane() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reportError = useCallback((message: string) => setError(message), []);
  const reportStatus = useCallback(
    (message: string) => {
      setError(null);
      setStatus(message);
    },
    [],
  );

  // --- Direct scan-and-upsert sources (Steam, GOG, itch, CrossOver) ---
  const steam = useSourceScan(DIRECT_SOURCES.steam.title, scanSteamSource, reportStatus, reportError);
  const gog = useSourceScan(DIRECT_SOURCES.gog.title, scanGogSource, reportStatus, reportError);
  const itch = useSourceScan(DIRECT_SOURCES.itch.title, scanItchSource, reportStatus, reportError);
  const crossover = useSourceScan(
    DIRECT_SOURCES.crossover.title,
    scanCrossoverSource,
    reportStatus,
    reportError,
  );

  // --- Apps (confirm-gated shortlist) ---
  const [appScanning, setAppScanning] = useState(false);
  const [shortlist, setShortlist] = useState<ShortlistRow[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function handleAppScan() {
    setAppScanning(true);
    setError(null);
    setStatus(null);
    try {
      const found = await scanAppSource();
      setShortlist(found.map((game: DiscoveredGame) => ({ game, checked: true })));
      if (found.length === 0) setStatus("App scan found no game-category apps.");
    } catch (e: unknown) {
      setError(isAppError(e) ? e.detail : String(e));
    } finally {
      setAppScanning(false);
    }
  }

  function toggleShortlistRow(index: number) {
    setShortlist((prev) =>
      prev
        ? prev.map((row, i) => (i === index ? { ...row, checked: !row.checked } : row))
        : prev,
    );
  }

  async function handleConfirmShortlist() {
    if (!shortlist) return;
    const chosen = selectChecked(shortlist.map((row) => ({ item: row.game, checked: row.checked })));
    if (chosen.length === 0) {
      setShortlist(null);
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const ids = await confirmAppEntries(chosen);
      setStatus(`Added ${ids.length} app(s) to the library.`);
      setShortlist(null);
    } catch (e: unknown) {
      setError(isAppError(e) ? e.detail : String(e));
    } finally {
      setConfirming(false);
    }
  }

  // --- Manual entry ---
  const [manualName, setManualName] = useState("");
  const [manualTarget, setManualTarget] = useState<ManualTarget | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  async function handlePickTarget() {
    const picked = await openFileDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Applications", extensions: ["app"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    if (picked.endsWith(".app")) {
      setManualTarget({ kind: "app", bundlePath: picked });
    } else {
      setManualTarget({ kind: "exec", program: picked, args: [] });
    }
  }

  async function handleAddManual() {
    setError(null);
    setStatus(null);
    const nameErr = manualNameError(manualName);
    const targetErr = manualTargetError(manualTarget);
    if (nameErr || targetErr) {
      setError(nameErr ?? targetErr);
      return;
    }
    setManualBusy(true);
    try {
      await addManualEntry(manualName.trim(), manualTarget as ManualTarget);
      setStatus(`Added "${manualName.trim()}" to the library.`);
      setManualName("");
      setManualTarget(null);
    } catch (e: unknown) {
      setError(isAppError(e) ? e.detail : String(e));
    } finally {
      setManualBusy(false);
    }
  }

  // --- SteamGridDB API key ---
  const [sgdbKeyInput, setSgdbKeyInput] = useState("");
  const [sgdbKeySaved, setSgdbKeySaved] = useState<string | null>(null);
  const [sgdbSaving, setSgdbSaving] = useState(false);

  const loadSgdbKey = useCallback(() => {
    getSteamGridDbApiKey()
      .then((key) => {
        setSgdbKeySaved(key);
        setSgdbKeyInput(key ?? "");
      })
      .catch((e: unknown) => setError(isAppError(e) ? e.detail : String(e)));
  }, []);

  useEffect(() => {
    loadSgdbKey();
  }, [loadSgdbKey]);

  async function handleSaveSgdbKey() {
    setError(null);
    setStatus(null);
    setSgdbSaving(true);
    try {
      const trimmed = sgdbKeyInput.trim();
      await setSteamGridDbApiKey(trimmed.length > 0 ? trimmed : null);
      setSgdbKeySaved(trimmed.length > 0 ? trimmed : null);
      setStatus(
        trimmed.length > 0
          ? "SteamGridDB API key saved."
          : "SteamGridDB API key cleared — the provider is now inert.",
      );
    } catch (e: unknown) {
      setError(isAppError(e) ? e.detail : String(e));
    } finally {
      setSgdbSaving(false);
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Game Sources</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Bring in games that live outside your ROM folders — Steam, GOG, or
        itch installs, native Mac apps, or anything else you launch by hand.
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>{error}</p>
      )}
      {status && !error && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>{status}</p>
      )}

      <ScanSourceRow
        title={DIRECT_SOURCES.steam.title}
        description={DIRECT_SOURCES.steam.description}
        scanLabel={DIRECT_SOURCES.steam.scanLabel}
        scanning={steam.scanning}
        onScan={() => { void steam.run(); }}
      />

      <ScanSourceRow
        title={DIRECT_SOURCES.gog.title}
        description={DIRECT_SOURCES.gog.description}
        scanLabel={DIRECT_SOURCES.gog.scanLabel}
        scanning={gog.scanning}
        onScan={() => { void gog.run(); }}
      />

      <ScanSourceRow
        title={DIRECT_SOURCES.itch.title}
        description={DIRECT_SOURCES.itch.description}
        scanLabel={DIRECT_SOURCES.itch.scanLabel}
        scanning={itch.scanning}
        onScan={() => { void itch.run(); }}
      />

      <ScanSourceRow
        title={DIRECT_SOURCES.crossover.title}
        description={DIRECT_SOURCES.crossover.description}
        scanLabel={DIRECT_SOURCES.crossover.scanLabel}
        scanning={crossover.scanning}
        onScan={() => { void crossover.run(); }}
      />

      <AppsSourceSection
        scanning={appScanning}
        shortlist={shortlist}
        confirming={confirming}
        onScan={() => { void handleAppScan(); }}
        onToggleRow={toggleShortlistRow}
        onCancel={() => setShortlist(null)}
        onConfirm={() => { void handleConfirmShortlist(); }}
      />

      <ManualEntrySection
        name={manualName}
        target={manualTarget}
        busy={manualBusy}
        onNameChange={setManualName}
        onPickTarget={() => { void handlePickTarget(); }}
        onAdd={() => { void handleAddManual(); }}
      />

      <SteamGridDbSection
        keyInput={sgdbKeyInput}
        keySaved={sgdbKeySaved}
        saving={sgdbSaving}
        onKeyInputChange={setSgdbKeyInput}
        onSave={() => { void handleSaveSgdbKey(); }}
      />
    </div>
  );
}
