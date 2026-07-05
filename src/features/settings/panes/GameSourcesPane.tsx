// GameSourcesPane — the Settings "Game sources" section (v0.31 W313; GOG +
// itch added v0.32 W320; SteamGridDB API key field added v0.32 W321).
//
// Six affordances, per docs/design/non-retro-library-design.md §UI:
// - Steam: trigger a re-scan (button calls scan_steam_source; W312).
// - Apps: run the /Applications + ~/Applications scan, then confirm a
//   checklist of the shortlist before any row is created (no silent library
//   flooding — see the design doc's confirm-gate requirement).
// - GOG: trigger a re-scan (button calls scan_gog_source; W320).
// - itch: trigger a re-scan (button calls scan_itch_source; W320).
// - Manual: a name + file-picker form that adds an escape-hatch entry.
// - SteamGridDB: an API key field for the art-fallback rung that covers
//   non-Steam titles (apps, manual, GOG, itch). Blank/absent leaves the
//   provider fully inert — scans and shelves behave exactly as v0.31 (§Art &
//   metadata, W321).
//
// GOG/itch mirror Steam exactly (an unconfirmed direct scan-and-upsert, no
// shortlist) rather than the Apps confirm-gate shape, since both sources are
// scoped installs (a Galaxy/itch-owned tree) rather than a broad system scan
// that could pick up non-games.
//
// Aura note: buttons fire native `click`, so this file uses React `onClick`
// throughout (never a Grimoire `aura-click` listener); `AuraField` wraps a
// contained `<input>` and never takes `value`/`type` props itself.

import { useCallback, useEffect, useState } from "react";
import { AuraButton, AuraField } from "@aura/react";

import {
  addManualEntry,
  confirmAppEntries,
  scanAppSource,
  scanGogSource,
  scanItchSource,
  scanSteamSource,
  type DiscoveredGame,
  type ManualTarget,
  type SourceScanReport,
} from "../../../ipc/sources";
import { getSteamGridDbApiKey, setSteamGridDbApiKey } from "../../../ipc/steamgriddb";
import { openFileDialog } from "../../../ipc/dialog";
import { isAppError } from "../../../ipc/commands";
import { manualNameError, manualTargetError, selectChecked } from "./gameSourcesGating";

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

/** A shortlist row's checklist state, keyed by its position in the scan result. */
interface ShortlistRow {
  game: DiscoveredGame;
  checked: boolean;
}

export function GameSourcesPane() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  /**
   * Shared shape for the direct scan-and-upsert sources (Steam, GOG, itch):
   * run `scan`, report the `{ discovered, added, updated }` counts as the
   * pane status, and surface any AppError. Kept as one function so the three
   * sources' handlers stay one-liners instead of duplicating this try/catch
   * (Apps has its own confirm-gated shape below and doesn't use this).
   */
  async function runDirectScan(label: string, scan: () => Promise<SourceScanReport>) {
    setError(null);
    setStatus(null);
    try {
      const report = await scan();
      setStatus(
        `${label} scan found ${report.discovered} game(s) — ${report.added} added, ${report.updated} updated.`,
      );
    } catch (e: unknown) {
      setError(isAppError(e) ? e.detail : String(e));
    }
  }

  // --- Steam ---
  const [steamScanning, setSteamScanning] = useState(false);

  async function handleSteamScan() {
    setSteamScanning(true);
    try {
      await runDirectScan("Steam", scanSteamSource);
    } finally {
      setSteamScanning(false);
    }
  }

  // --- GOG ---
  const [gogScanning, setGogScanning] = useState(false);

  async function handleGogScan() {
    setGogScanning(true);
    try {
      await runDirectScan("GOG", scanGogSource);
    } finally {
      setGogScanning(false);
    }
  }

  // --- itch ---
  const [itchScanning, setItchScanning] = useState(false);

  async function handleItchScan() {
    setItchScanning(true);
    try {
      await runDirectScan("itch", scanItchSource);
    } finally {
      setItchScanning(false);
    }
  }

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
      setShortlist(found.map((game) => ({ game, checked: true })));
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

      {/* Steam */}
      <div
        className="rgp-panel"
        style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 8 }}
      >
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>Steam</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
            Scans installed Steam titles from your local Steam library.
          </p>
        </div>
        <AuraButton tabIndex={0} disabled={steamScanning} onClick={() => { void handleSteamScan(); }}>
          {steamScanning ? "Scanning…" : "Scan Steam library"}
        </AuraButton>
      </div>

      {/* GOG */}
      <div
        className="rgp-panel"
        style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 8 }}
      >
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>GOG</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
            Scans installed GOG Galaxy titles from your local GOG library.
          </p>
        </div>
        <AuraButton tabIndex={0} disabled={gogScanning} onClick={() => { void handleGogScan(); }}>
          {gogScanning ? "Scanning…" : "Scan GOG library"}
        </AuraButton>
      </div>

      {/* itch */}
      <div
        className="rgp-panel"
        style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 8 }}
      >
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>itch</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
            Scans installed itch titles from your local itch app installs.
          </p>
        </div>
        <AuraButton tabIndex={0} disabled={itchScanning} onClick={() => { void handleItchScan(); }}>
          {itchScanning ? "Scanning…" : "Scan itch library"}
        </AuraButton>
      </div>

      {/* Apps */}
      <div
        className="rgp-panel"
        style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, borderRadius: 8 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>Applications</p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
              Scans /Applications and ~/Applications for game-category apps.
              You confirm before anything is added.
            </p>
          </div>
          <AuraButton tabIndex={0} disabled={appScanning} onClick={() => { void handleAppScan(); }}>
            {appScanning ? "Scanning…" : "Scan Applications"}
          </AuraButton>
        </div>

        {shortlist && shortlist.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
              Confirm which of these to add:
            </p>
            {shortlist.map((row, i) => (
              <label
                key={`${row.game.externalId ?? row.game.name}-${i}`}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  tabIndex={0}
                  checked={row.checked}
                  onChange={() => toggleShortlistRow(i)}
                />
                {row.game.name}
              </label>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <AuraButton
                tabIndex={0}
                variant="ghost"
                disabled={confirming}
                onClick={() => setShortlist(null)}
              >
                Cancel
              </AuraButton>
              <AuraButton
                tabIndex={0}
                variant="primary"
                disabled={confirming}
                onClick={() => { void handleConfirmShortlist(); }}
              >
                {confirming ? "Adding…" : "Add selected"}
              </AuraButton>
            </div>
          </div>
        )}
      </div>

      {/* Manual entry */}
      <div
        className="rgp-panel"
        style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 8 }}
      >
        <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>Add manually</p>
        <div style={{ display: "flex", gap: 8 }}>
          <AuraField tabIndex={0} style={{ flex: 1 }}>
            <input
              type="text"
              placeholder="Name"
              tabIndex={0}
              value={manualName}
              onChange={(e) => setManualName(e.currentTarget.value)}
              style={inputStyle}
            />
          </AuraField>
          <AuraButton tabIndex={0} variant="secondary" onClick={() => { void handlePickTarget(); }}>
            {manualTarget
              ? manualTarget.kind === "app"
                ? manualTarget.bundlePath.split("/").pop()
                : manualTarget.program.split("/").pop()
              : "Choose target…"}
          </AuraButton>
          <AuraButton
            tabIndex={0}
            disabled={manualBusy}
            onClick={() => { void handleAddManual(); }}
          >
            {manualBusy ? "Adding…" : "Add"}
          </AuraButton>
        </div>
      </div>

      {/* SteamGridDB art */}
      <div
        className="rgp-panel"
        style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 8 }}
      >
        <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>SteamGridDB art</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
          Fetches box/grid art for non-Steam titles (apps, manual entries,
          GOG, itch) by name. Leave blank to leave this provider off — scans
          and shelves work the same either way, just without this extra art
          source.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <AuraField tabIndex={0} style={{ flex: 1 }}>
            <input
              type="password"
              placeholder="SteamGridDB API key"
              tabIndex={0}
              value={sgdbKeyInput}
              onChange={(e) => setSgdbKeyInput(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSaveSgdbKey(); }}
              style={inputStyle}
            />
          </AuraField>
          <AuraButton
            tabIndex={0}
            disabled={sgdbSaving || sgdbKeyInput.trim() === (sgdbKeySaved ?? "")}
            onClick={() => { void handleSaveSgdbKey(); }}
          >
            {sgdbSaving ? "Saving…" : "Save"}
          </AuraButton>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
          {sgdbKeySaved ? "A key is configured." : "No key configured — provider is inert."}
        </p>
      </div>
    </div>
  );
}
