/** Empty state shown when no providers are configured. */
import { AuraButton, AuraCard } from "@aura/react";

export function EmptyState({
  onAddProvider,
  onBrowse,
}: {
  onAddProvider: () => void;
  onBrowse: () => void;
}) {
  return (
    <AuraCard
      class="harmony-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: 40,
        textAlign: "center",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 32,
          lineHeight: 1,
          opacity: 0.4,
        }}
      >
        🔍
      </p>
      <h2 style={{ margin: 0, fontSize: 18 }}>No search providers yet</h2>
      <p style={{ margin: 0, color: "var(--aura-on-surface-muted)" }}>
        Add a provider to get started. A provider is a URL template like{" "}
        <code
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            background: "var(--aura-surface-raised)",
            padding: "1px 5px",
            borderRadius: 4,
          }}
        >
          https://example.com?q={"{query}"}
        </code>
        . Harmony constructs the link and opens it in your browser — it never
        downloads anything automatically.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <AuraButton variant="primary" onClick={onBrowse}>
          ⊞ Browse providers
        </AuraButton>
        <AuraButton variant="ghost" onClick={onAddProvider}>
          + Add your own
        </AuraButton>
      </div>
    </AuraCard>
  );
}
