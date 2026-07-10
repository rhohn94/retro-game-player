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
            onClick={() => {
              // `onClick` alone only claims controller focus (FocusableAction's
              // render-prop contract) — a contained-less AuraButton has no
              // other native handler to own the real action, so a real mouse
              // click or keyboard Enter/Space must also invoke it here
              // directly (matches ResultsToolbar's Expand/Collapse-all
              // precedent). Without this, clicking + Add silently did
              // nothing — only a gamepad confirm actually opened the dialog.
              onClick();
              onAddProvider();
            }}
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
            onClick={() => {
              // Same fix as + Add above — see that comment.
              onClick();
              onBrowse();
            }}
          >
            ⊞ Browse providers
          </AuraButton>
        )}
      />
    </div>
  );
}
