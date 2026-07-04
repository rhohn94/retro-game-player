// GameSourcesPane — the Settings "Game sources" section (v0.31 W313).
//
// Three affordances, per docs/design/non-retro-library-design.md §UI:
// - Steam: trigger a re-scan (button calls scan_steam_source; W312).
// - Apps: run the /Applications + ~/Applications scan, then confirm a
//   checklist of the shortlist before any row is created (no silent library
//   flooding — see the design doc's confirm-gate requirement).
// - Manual: a name + file-picker form that adds an escape-hatch entry.
//
// Aura note: buttons fire native `click`, so this file uses React `onClick`
// throughout (never a Grimoire `aura-click` listener); `AuraField` wraps a
// contained `<input>` and never takes `value`/`type` props itself.

import { useState } from "react";
import { AuraButton, AuraField } from "@aura/react";

import {
  addManualEntry,
  confirmAppEntries,
  scanAppSource,
  scanSteamSource,
  type DiscoveredGame,
  type ManualTarget,
} from "../../../ipc/sources";
import { openFileDialog } from "../../../ipc/dialog";
import { isAppError } from "../../../ipc/commands";

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

  // --- Steam ---
  const [steamScanning, setSteamScanning] = useState(false);

  async function handleSteamScan() {
    setSteamScanning(true);
    setError(null);
    setStatus(null);
    try {
      const found = await scanSteamSource();
      setStatus(`Steam scan found ${found.length} game(s).`);
    } catch (e: unknown) {
      setError(isAppError(e) ? e.detail : String(e));
    } finally {
      setSteamScanning(false);
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
    const chosen = shortlist.filter((r) => r.checked).map((r) => r.game);
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

  function manualNameError(): string | null {
    if (manualName.trim().length === 0) return "Name is required.";
    return null;
  }

  function manualTargetError(): string | null {
    if (!manualTarget) return "Choose an app or executable.";
    return null;
  }

  async function handleAddManual() {
    setError(null);
    setStatus(null);
    const nameErr = manualNameError();
    const targetErr = manualTargetError();
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

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Game Sources</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Bring in games that live outside your ROM folders — Steam installs,
        native Mac apps, or anything else you launch by hand.
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
    </div>
  );
}
