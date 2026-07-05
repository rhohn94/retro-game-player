// ScanSourceRow — a single "direct scan-and-upsert" source row in
// GameSourcesPane (Steam/GOG/itch/CrossOver). Extracted in W366 from the
// four near-identical rows: a title + one-line description on the left, a
// scan button on the right whose label swaps to a "Scanning…" busy state.

import { AuraButton } from "@aura/react";

export interface ScanSourceRowProps {
  /** Source name, e.g. "Steam". */
  title: string;
  /** One-line description of what the scan covers. */
  description: string;
  /** Button label while idle, e.g. "Scan Steam library". */
  scanLabel: string;
  /** True while this source's scan is in flight. */
  scanning: boolean;
  onScan: () => void;
}

/** Renders one direct-scan source row (Steam/GOG/itch/CrossOver share this shape). */
export function ScanSourceRow({ title, description, scanLabel, scanning, onScan }: ScanSourceRowProps) {
  return (
    <div
      className="rgp-panel"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 8 }}
    >
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>{title}</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
          {description}
        </p>
      </div>
      <AuraButton tabIndex={0} disabled={scanning} onClick={onScan}>
        {scanning ? "Scanning…" : scanLabel}
      </AuraButton>
    </div>
  );
}
