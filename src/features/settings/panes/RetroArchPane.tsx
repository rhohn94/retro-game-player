// RetroArchPane — the Settings "RetroArch" section (binary path configuration).

import { useState, useEffect } from "react";

import { locateRetroArch, setRetroArchPath } from "../../../ipc/launch";
import { LocateToolPane, locateToolInputStyle } from "./LocateToolPane";

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
    <LocateToolPane
      title="RetroArch"
      description="Path to the RetroArch binary used for launching games."
      error={error}
      fieldLabel="RetroArch path"
      saving={saving}
      saved={saved}
      onSave={() => { void handleSave(); }}
      fieldInput={
        <input
          type="text"
          placeholder="/Applications/RetroArch.app/Contents/MacOS/RetroArch"
          value={path}
          tabIndex={0}
          onChange={(e) => setPath(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
          style={locateToolInputStyle}
        />
      }
    />
  );
}
