/**
 * ProviderDialog — add or edit a search provider (name + URL template).
 *
 * Renders inside an `<aura-dialog>` sheet. The caller controls open/close state
 * and passes `onSave`/`onClose`. The dialog is controller-navigable: focus
 * starts on the Name field and moves through URL → Save → Cancel via nav keys.
 * Design: harmony-ux-design.md §5, file-search-design.md §UI (W17).
 */
import { useState, useEffect, useRef } from "react";
import { AuraDialog, AuraButton, AuraField } from "@aura/react";
import type { SearchProvider } from "../../ipc/search";

export interface ProviderFormData {
  name: string;
  urlTemplate: string;
}

interface ProviderDialogProps {
  /** When set, the dialog is open and pre-fills fields from the provider. */
  open: boolean;
  /** If editing, the existing provider; undefined when adding. */
  provider?: SearchProvider;
  onSave: (data: ProviderFormData) => void;
  onClose: () => void;
}

/** Validation: URL template must be non-empty and contain `{query}`. */
function validate(data: ProviderFormData): string | null {
  if (!data.name.trim()) return "Name is required.";
  if (!data.urlTemplate.trim()) return "URL template is required.";
  if (!data.urlTemplate.includes("{query}"))
    return 'URL template must contain the {query} placeholder.';
  return null;
}

export function ProviderDialog({
  open,
  provider,
  onSave,
  onClose,
}: ProviderDialogProps) {
  const [name, setName] = useState(provider?.name ?? "");
  const [urlTemplate, setUrlTemplate] = useState(provider?.urlTemplate ?? "");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLElement>(null);

  // Reset fields when the dialog opens or the provider changes.
  useEffect(() => {
    if (open) {
      setName(provider?.name ?? "");
      setUrlTemplate(provider?.urlTemplate ?? "");
      setError(null);
    }
  }, [open, provider]);

  // Auto-focus the name field on open.
  useEffect(() => {
    if (open) {
      // Defer one frame so the dialog element has attached.
      const id = requestAnimationFrame(() => {
        (nameRef.current as HTMLInputElement | null)?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  function handleSave() {
    const data: ProviderFormData = { name: name.trim(), urlTemplate: urlTemplate.trim() };
    const err = validate(data);
    if (err) {
      setError(err);
      return;
    }
    onSave(data);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") onClose();
  }

  if (!open) return null;

  const title = provider ? "Edit Provider" : "Add Provider";

  return (
    <AuraDialog
      class="harmony-provider-dialog"
      open
      style={{
        "--aura-dialog-width": "420px",
      } as React.CSSProperties}
    >
      <div
        onKeyDown={handleKeyDown}
        style={{ display: "flex", flexDirection: "column", gap: 16, padding: 4 }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
            Name
          </label>
          <AuraField
            ref={nameRef}
            name="provider-name"
            type="text"
            value={name}
            placeholder="e.g. DuckDuckGo"
            events={{
              "aura-field:input": (e) => setName((e as CustomEvent<{ value: string }>).detail.value),
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
            URL Template <span style={{ opacity: 0.6 }}>(must contain &#123;query&#125;)</span>
          </label>
          <AuraField
            name="provider-url"
            type="text"
            value={urlTemplate}
            placeholder="https://example.com/search?q={query}"
            events={{
              "aura-field:input": (e) =>
                setUrlTemplate((e as CustomEvent<{ value: string }>).detail.value),
            }}
          />
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-error, #e74c3c)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <AuraButton variant="ghost" onClick={onClose}>
            Cancel
          </AuraButton>
          <AuraButton variant="primary" onClick={handleSave}>
            Save
          </AuraButton>
        </div>
      </div>
    </AuraDialog>
  );
}
