/**
 * ProviderCatalog — discover & add providers from a curated directory (v0.20).
 *
 * A searchable, filterable gallery of vetted legitimate providers (storefronts,
 * indie/homebrew and demoscene archives, preservation libraries, reference
 * databases). One click adds an entry as a normal search provider, which the
 * user can then edit/disable/remove. Entries whose search page is JavaScript-
 * rendered are flagged honestly (the static preview finds nothing on them yet).
 *
 * This is the discovery surface that keeps high-value sources one click away
 * without the user hand-crafting templates. It lists only legitimate sources;
 * anything else is added via the provider dialog.
 */
import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { AuraDialog, AuraButton, AuraField } from "@aura/react";
import { dialogPop } from "../../lib/motion";
import { listProviderCatalog, addProvider } from "../../ipc/search";
import type { CatalogProvider, SearchProvider } from "../../ipc/search";
import { isAppError } from "../../ipc/commands";

interface ProviderCatalogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the created provider after a successful add. */
  onAdded: (provider: SearchProvider) => void;
}

/** A small media-type filter chip. */
function MediaChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        border: `1.5px solid ${active ? "var(--aura-primary)" : "var(--aura-on-surface-muted)"}`,
        background: active ? "var(--harmony-provider-enabled-bg)" : "transparent",
        color: active ? "var(--aura-primary)" : "var(--aura-on-surface-muted)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

/** One catalog row with its metadata and an Add/Added action. */
function CatalogRow({
  entry,
  adding,
  onAdd,
}: {
  entry: CatalogProvider;
  adding: boolean;
  onAdd: (entry: CatalogProvider) => void;
}) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 4px",
        borderTop: "1px solid var(--aura-outline-subtle, transparent)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {entry.kind === "download" ? "⬇ " : ""}
            {entry.name}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--aura-on-surface-muted)",
              border: "1px solid var(--aura-on-surface-muted)",
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            {entry.media}
          </span>
          {entry.jsRendered && (
            <span
              title="This site is JavaScript-rendered — the preview can't read it yet (support coming soon)."
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--aura-on-surface-muted)",
                border: "1px dashed var(--aura-on-surface-muted)",
                borderRadius: 4,
                padding: "1px 5px",
              }}
            >
              needs JS · soon
            </span>
          )}
        </div>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 12,
            color: "var(--aura-on-surface-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.description}
        </p>
      </div>
      {entry.added ? (
        <span
          style={{
            fontSize: 12,
            color: "var(--aura-success)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          ✓ Added
        </span>
      ) : (
        <AuraButton variant="ghost" onClick={() => onAdd(entry)} disabled={adding}>
          {adding ? "Adding…" : "+ Add"}
        </AuraButton>
      )}
    </li>
  );
}

export function ProviderCatalog({ open, onClose, onAdded }: ProviderCatalogProps) {
  const [entries, setEntries] = useState<CatalogProvider[]>([]);
  const [filter, setFilter] = useState("");
  const [media, setMedia] = useState<string>("All");
  const [addingName, setAddingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the catalog whenever the sheet opens (so `added` reflects current state).
  useEffect(() => {
    if (!open) return;
    setFilter("");
    setMedia("All");
    setError(null);
    listProviderCatalog()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [open]);

  const mediaTypes = useMemo(
    () => ["All", ...Array.from(new Set(entries.map((e) => e.media)))],
    [entries]
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (media !== "All" && e.media !== media) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.media.toLowerCase().includes(q)
      );
    });
  }, [entries, filter, media]);

  async function handleAdd(entry: CatalogProvider) {
    setAddingName(entry.name);
    setError(null);
    try {
      const created = await addProvider({
        name: entry.name,
        urlTemplate: entry.urlTemplate,
        kind: entry.kind,
      });
      // Mark added locally and bubble up so the page's provider list refreshes.
      setEntries((prev) =>
        prev.map((e) => (e.name === entry.name ? { ...e, added: true } : e))
      );
      onAdded(created);
    } catch (err) {
      setError(isAppError(err) ? err.detail : String(err));
    } finally {
      setAddingName(null);
    }
  }

  if (!open) return null;

  return (
    <AuraDialog
      class="harmony-provider-catalog"
      open
      style={{ "--aura-dialog-width": "560px" } as React.CSSProperties}
    >
      <motion.div
        initial={dialogPop.initial}
        animate={dialogPop.animate}
        style={{ display: "flex", flexDirection: "column", gap: 12, padding: 4 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>Browse providers</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--aura-on-surface-muted)",
            }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
          Curated legitimate sources — storefronts, homebrew and demoscene
          archives, libraries, and reference sites. Add any in one click, then
          edit or remove it like your own. Need a site that isn't here? Use{" "}
          <strong>+ Add</strong> to enter any provider yourself.
        </p>

        <AuraField>
          <input
            name="catalog-filter"
            className="harmony-input"
            type="search"
            value={filter}
            placeholder="Search providers…"
            onChange={(e) => setFilter(e.target.value)}
          />
        </AuraField>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {mediaTypes.map((m) => (
            <MediaChip
              key={m}
              label={m}
              active={media === m}
              onClick={() => setMedia(m)}
            />
          ))}
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-error)" }}>{error}</p>
        )}

        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {visible.length === 0 ? (
            <li style={{ padding: "16px 4px", fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
              No providers match.
            </li>
          ) : (
            visible.map((entry) => (
              <CatalogRow
                key={entry.name}
                entry={entry}
                adding={addingName === entry.name}
                onAdd={handleAdd}
              />
            ))
          )}
        </ul>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <AuraButton variant="primary" onClick={onClose}>
            Done
          </AuraButton>
        </div>
      </motion.div>
    </AuraDialog>
  );
}
