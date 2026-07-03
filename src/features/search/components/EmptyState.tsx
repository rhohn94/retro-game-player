/** Empty state shown when no providers are configured. */
import { useEffect } from "react";
import { AuraButton, AuraCard } from "@aura/react";
import { FocusRing, useFocusable } from "../../controller";

export function EmptyState({
  onAddProvider,
  onBrowse,
}: {
  onAddProvider: () => void;
  onBrowse: () => void;
}) {
  // Registers both call-to-action buttons with the spatial-nav registry
  // (W268) so a controller-only user isn't stuck on the empty-providers state.
  const browse = useFocusable<HTMLElement>("search:empty:browse", onBrowse);
  const add = useFocusable<HTMLElement>("search:empty:add", onAddProvider);
  useEffect(() => {
    if (browse.isFocused) browse.ref.current?.focus();
  }, [browse.isFocused, browse.ref]);
  useEffect(() => {
    if (add.isFocused) add.ref.current?.focus();
  }, [add.isFocused, add.ref]);

  return (
    <AuraCard
      class="rgp-panel"
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
        . Retro Game Player constructs the link and opens it in your browser —
        it never downloads anything automatically.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <FocusRing focused={browse.isFocused}>
          <AuraButton ref={browse.ref} variant="primary" onClick={onBrowse}>
            ⊞ Browse providers
          </AuraButton>
        </FocusRing>
        <FocusRing focused={add.isFocused}>
          <AuraButton ref={add.ref} variant="ghost" onClick={onAddProvider}>
            + Add your own
          </AuraButton>
        </FocusRing>
      </div>
    </AuraCard>
  );
}
