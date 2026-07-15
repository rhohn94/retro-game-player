/** Selection footer: selected count, open in browser, optional batch download. */
import { AuraButton } from "@aura/react";
import { FocusableAction } from "./FocusableControls";

export function SelectionFooter({
  count,
  downloadableCount,
  onClear,
  onOpenSelected,
  onDownloadSelected,
}: {
  count: number;
  /** How many selected rows can direct-download (0 hides the button). */
  downloadableCount?: number;
  onClear: () => void;
  onOpenSelected: () => void;
  onDownloadSelected?: () => void;
}) {
  const canDl = (downloadableCount ?? 0) > 0 && onDownloadSelected;
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
      {canDl && (
        <FocusableAction
          focusId="search:download-selected"
          onActivate={onDownloadSelected}
          render={({ ref, onClick }) => (
            <AuraButton
              ref={ref}
              variant="secondary"
              onClick={() => {
                onClick();
                onDownloadSelected();
              }}
            >
              Download {downloadableCount}
            </AuraButton>
          )}
        />
      )}
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
