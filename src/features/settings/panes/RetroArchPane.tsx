// RetroArchPane — the Settings "RetroArch" section (binary path configuration).

import { useState, useEffect } from "react";
import { AuraButton, AuraField } from "@aura/react";

import { locateRetroArch, setRetroArchPath } from "../../../ipc/launch";

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

export function RetroArchPane() {
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    locateRetroArch()
      .then((p) => { if (p) setPath(p); })
      .catch(() => { /* not installed / not found — leave the field empty */ });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await setRetroArchPath(path.trim());
      setSaved(true);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>RetroArch</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Path to the RetroArch binary used for launching games.
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <AuraField label="RetroArch path" tabIndex={0}>
        <input
          type="text"
          placeholder="/Applications/RetroArch.app/Contents/MacOS/RetroArch"
          value={path}
          tabIndex={0}
          onChange={(e) => setPath(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
          style={inputStyle}
        />
      </AuraField>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AuraButton
          tabIndex={0}
          disabled={saving}
          onClick={() => { void handleSave(); }}
        >
          {saving ? "Saving…" : "Save"}
        </AuraButton>
        {saved && (
          <span style={{ fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}
