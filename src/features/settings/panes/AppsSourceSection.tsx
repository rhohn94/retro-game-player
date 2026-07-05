// AppsSourceSection — the "Applications" confirm-gated source in
// GameSourcesPane: a scan button plus a checklist shortlist the user must
// confirm before any app is added to the library (no silent library
// flooding — non-retro-library-design.md §UI). Extracted in W366 to shrink
// GameSourcesPane's own body/complexity.

import { AuraButton } from "@aura/react";
import type { DiscoveredGame } from "../../../ipc/sources";

/** A shortlist row's checklist state, keyed by its position in the scan result. */
export interface ShortlistRow {
  game: DiscoveredGame;
  checked: boolean;
}

export interface AppsSourceSectionProps {
  scanning: boolean;
  shortlist: ShortlistRow[] | null;
  confirming: boolean;
  onScan: () => void;
  onToggleRow: (index: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AppsSourceSection(props: AppsSourceSectionProps) {
  const { scanning, shortlist, confirming, onScan, onToggleRow, onCancel, onConfirm } = props;

  return (
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
        <AuraButton tabIndex={0} disabled={scanning} onClick={onScan}>
          {scanning ? "Scanning…" : "Scan Applications"}
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
                onChange={() => onToggleRow(i)}
              />
              {row.game.name}
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <AuraButton tabIndex={0} variant="ghost" disabled={confirming} onClick={onCancel}>
              Cancel
            </AuraButton>
            <AuraButton tabIndex={0} variant="primary" disabled={confirming} onClick={onConfirm}>
              {confirming ? "Adding…" : "Add selected"}
            </AuraButton>
          </div>
        </div>
      )}
    </div>
  );
}
