// LocateToolPane — shared skeleton for a Settings pane that locates/configures
// a single external tool by path or URL (extracted in W366 from the
// near-identical FamiliarPane/RetroArchPane bodies: title, description, error
// banner, a labeled text field, and a Save button with a "Saved." indicator).
// Callers own their own field(s) and any extra status UI via `children`,
// which renders between the error banner and the primary input.

import { AuraButton, AuraField } from "@aura/react";

/** Shared style for the panes' plain `<input>` fields (kept local — panes
 * pass their own `type`/`placeholder`/handlers via props, never as
 * AuraField props, per the Aura interaction contract). */
export const locateToolInputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

export interface LocateToolPaneProps {
  /** Pane heading, e.g. "RetroArch". */
  title: string;
  /** One-line description shown under the heading. */
  description: string;
  /** Top-level error message, if any. */
  error: string | null;
  /** Label for the primary path/URL field. */
  fieldLabel: string;
  /** The primary field's `<input>` element (owns its own type/value/handlers). */
  fieldInput: React.ReactNode;
  /** True while a save is in flight — disables the Save button. */
  saving: boolean;
  /** True once the most recent save has completed successfully. */
  saved: boolean;
  /** Invoked when the Save button is pressed. */
  onSave: () => void;
  /** Extra content rendered between the error banner and the primary field
   * (e.g. FamiliarPane's connection-status block, or a second field). */
  children?: React.ReactNode;
}

/** Renders the shared "locate an external tool" pane layout. */
export function LocateToolPane(props: LocateToolPaneProps) {
  const { title, description, error, fieldLabel, fieldInput, saving, saved, onSave, children } = props;

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        {description}
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      {children}

      <AuraField label={fieldLabel} tabIndex={0}>
        {fieldInput}
      </AuraField>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AuraButton tabIndex={0} disabled={saving} onClick={onSave}>
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
