// ManualEntrySection — the "Add manually" escape-hatch source in
// GameSourcesPane: a name field, a target (app/executable) picker, and an
// Add button. Extracted in W366 to shrink GameSourcesPane's own
// body/complexity.

import { AuraButton, AuraField } from "@aura/react";
import type { ManualTarget } from "../../../ipc/sources";
import { manualTargetLabel } from "./gameSourcesGating";

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

export interface ManualEntrySectionProps {
  name: string;
  target: ManualTarget | null;
  busy: boolean;
  onNameChange: (name: string) => void;
  onPickTarget: () => void;
  onAdd: () => void;
}

export function ManualEntrySection(props: ManualEntrySectionProps) {
  const { name, target, busy, onNameChange, onPickTarget, onAdd } = props;

  return (
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
            value={name}
            onChange={(e) => onNameChange(e.currentTarget.value)}
            style={inputStyle}
          />
        </AuraField>
        <AuraButton tabIndex={0} variant="secondary" onClick={onPickTarget}>
          {manualTargetLabel(target)}
        </AuraButton>
        <AuraButton tabIndex={0} disabled={busy} onClick={onAdd}>
          {busy ? "Adding…" : "Add"}
        </AuraButton>
      </div>
    </div>
  );
}
