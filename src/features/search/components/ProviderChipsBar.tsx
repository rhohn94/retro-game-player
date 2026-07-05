/** Provider-management row: the configured providers as toggle/edit/remove
 *  chips, plus "+ Add" and "Browse providers" actions — or, with no providers
 *  configured, the guiding empty state (W362, extracted from SearchPage). */
import { AuraButton } from "@aura/react";
import type { SearchProvider } from "../../../ipc/search";
import { EmptyState } from "./EmptyState";
import { ProviderChip } from "./MergedResultsView";
import { FocusableAction } from "./FocusableControls";

export function ProviderChipsBar({
  providers,
  hasProviders,
  onToggle,
  onEdit,
  onRemove,
  onAddProvider,
  onBrowse,
}: {
  providers: SearchProvider[];
  hasProviders: boolean;
  onToggle: (id: number) => void;
  onEdit: (provider: SearchProvider) => void;
  onRemove: (id: number) => void;
  onAddProvider: () => void;
  onBrowse: () => void;
}) {
  if (!hasProviders) {
    return <EmptyState onAddProvider={onAddProvider} onBrowse={onBrowse} />;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 13, color: "var(--aura-on-surface-muted)", marginRight: 2 }}>
        Providers:
      </span>
      {providers.map((p) => (
        <ProviderChip
          key={p.id}
          provider={p}
          onToggle={onToggle}
          onEdit={onEdit}
          onRemove={onRemove}
          focusId={`search:provider:${p.id}`}
        />
      ))}
      <FocusableAction
        focusId="search:add-provider"
        onActivate={onAddProvider}
        render={({ ref, onClick }) => (
          <AuraButton
            ref={ref}
            variant="ghost"
            style={{ fontSize: 13, padding: "4px 10px" }}
            onClick={onClick}
          >
            + Add
          </AuraButton>
        )}
      />
      <FocusableAction
        focusId="search:browse-providers"
        onActivate={onBrowse}
        render={({ ref, onClick }) => (
          <AuraButton
            ref={ref}
            variant="ghost"
            style={{ fontSize: 13, padding: "4px 10px" }}
            onClick={onClick}
          >
            ⊞ Browse providers
          </AuraButton>
        )}
      />
    </div>
  );
}
