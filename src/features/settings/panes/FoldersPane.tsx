// FoldersPane — the Settings "Folders" section (content folder management).

import { useCallback, useEffect, useRef, useState } from "react";
import { AuraButton, AuraField } from "@aura/react";

import {
  addContentFolder,
  listContentFolders,
  removeContentFolder,
  scanFolder,
  type ContentFolder,
  type ScanReport,
} from "../../../ipc/library";
import { CreateGamesFolderDialog } from "../../library/CreateGamesFolderDialog";

export function FoldersPane() {
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [scanResult, setScanResult] = useState<ScanReport | null>(null);
  const [scanning, setScanning] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    listContentFolders()
      .then(setFolders)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    const path = addInputRef.current?.value.trim();
    if (!path) return;
    try {
      const folder = await addContentFolder(path);
      if (addInputRef.current) addInputRef.current.value = "";
      setFolders((prev) => [...prev, folder]);
      setError(null);
      // Kick off a scan immediately after adding
      handleScan(folder.id);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function handleRemove(id: number) {
    try {
      await removeContentFolder(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function handleScan(id: number) {
    setScanning(id);
    setScanResult(null);
    try {
      const report = await scanFolder(id);
      setScanResult(report);
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setScanning(null);
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Content Folders</h3>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <AuraField tabIndex={0} style={{ flex: 1 }}>
          <input
            ref={addInputRef}
            type="text"
            placeholder="/path/to/roms"
            tabIndex={0}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--aura-border)",
              background: "var(--aura-surface-2)",
              color: "var(--aura-on-surface)",
              fontSize: 14,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
          />
        </AuraField>
        <AuraButton tabIndex={0} onClick={() => { void handleAdd(); }}>
          Add Folder
        </AuraButton>
      </div>

      {scanResult && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
          Scan complete — scanned {scanResult.scanned}, added {scanResult.added},
          identified {scanResult.identified}.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {folders.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <p style={{ color: "var(--aura-on-surface-muted)", margin: 0, fontSize: 13 }}>
              No content folders configured.
            </p>
            <AuraButton
              tabIndex={0}
              variant="secondary"
              onClick={() => setShowCreate(true)}
            >
              Create a games folder for me
            </AuraButton>
          </div>
        )}
        {folders.map((f) => (
          <div
            key={f.id}
            className="harmony-panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 8,
            }}
          >
            <span style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>{f.path}</span>
            <AuraButton
              tabIndex={0}
              variant="secondary"
              disabled={scanning === f.id}
              onClick={() => { void handleScan(f.id); }}
            >
              {scanning === f.id ? "Scanning…" : "Rescan"}
            </AuraButton>
            <AuraButton
              tabIndex={0}
              variant="ghost"
              onClick={() => { void handleRemove(f.id); }}
            >
              Remove
            </AuraButton>
          </div>
        ))}
      </div>

      <CreateGamesFolderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          load();
        }}
      />
    </div>
  );
}
