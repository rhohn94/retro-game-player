// SteamGridDbSection — the SteamGridDB API key field in GameSourcesPane, an
// optional art-fallback provider for non-Steam titles. Extracted in W366 to
// shrink GameSourcesPane's own body/complexity.

import { AuraButton, AuraField } from "@aura/react";

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

export interface SteamGridDbSectionProps {
  keyInput: string;
  keySaved: string | null;
  saving: boolean;
  onKeyInputChange: (value: string) => void;
  onSave: () => void;
}

export function SteamGridDbSection(props: SteamGridDbSectionProps) {
  const { keyInput, keySaved, saving, onKeyInputChange, onSave } = props;

  return (
    <div
      className="rgp-panel"
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 8 }}
    >
      <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>SteamGridDB art</p>
      <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
        Fetches box/grid art for non-Steam titles (apps, manual entries,
        GOG, itch, CrossOver) by name. Leave blank to leave this provider
        off — scans and shelves work the same either way, just without this
        extra art source.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <AuraField tabIndex={0} style={{ flex: 1 }}>
          <input
            type="password"
            placeholder="SteamGridDB API key"
            tabIndex={0}
            value={keyInput}
            onChange={(e) => onKeyInputChange(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
            style={inputStyle}
          />
        </AuraField>
        <AuraButton
          tabIndex={0}
          disabled={saving || keyInput.trim() === (keySaved ?? "")}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </AuraButton>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
        {keySaved ? "A key is configured." : "No key configured — provider is inert."}
      </p>
    </div>
  );
}
