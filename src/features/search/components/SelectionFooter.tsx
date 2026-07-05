/** Selection footer: shows the selected-result count and batch-opens the
 *  chosen links in the browser (W362, extracted from SearchPage). Rendered
 *  only while at least one result row is selected. */
import { AuraButton } from "@aura/react";
import { FocusableAction } from "./FocusableControls";

export function SelectionFooter({
  count,
  onClear,
  onOpenSelected,
}: {
  count: number;
  onClear: () => void;
  onOpenSelected: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderTop: "1px solid var(--aura-outline-subtle, transparent)",
        background: "var(--aura-surface-raised)",
      }}
    >
      <span style={{ flex: 1, fontSize: 13 }}>{count} selected</span>
      <FocusableAction
        focusId="search:clear-selection"
        onActivate={onClear}
        render={({ ref, onClick }) => (
          <button
            ref={ref as React.Ref<HTMLButtonElement>}
            onClick={() => {
              onClick();
              onClear();
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontSize: 12,
              color: "var(--aura-on-surface-muted)",
            }}
          >
            Clear
          </button>
        )}
      />
      <FocusableAction
        focusId="search:open-selected"
        onActivate={onOpenSelected}
        render={({ ref, onClick }) => (
          <AuraButton
            ref={ref}
            variant="primary"
            onClick={() => {
              onClick();
              onOpenSelected();
            }}
          >
            Open {count} in browser ↗
          </AuraButton>
        )}
      />
    </div>
  );
}
