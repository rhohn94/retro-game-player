/**
 * SearchPage — File-search UI screen (W17).
 *
 * Route: /search. Archetype: Search / Query-results (harmony-ux-design.md §5).
 *
 * Key contracts:
 *  - Results are LINKS ONLY — never auto-downloaded. Each result's `url` is
 *    opened in the system browser via tauri-plugin-opener. (file-search-design.md §2)
 *  - Ships with an empty provider list; guides the user to add one.
 *  - Controller-navigable: query field → provider chips → result links → add button.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AuraButton, AuraField, AuraCard } from "@aura/react";
import {
  listProviders,
  addProvider,
  updateProvider,
  removeProvider,
  runSearch,
} from "../../ipc/search";
import type { SearchProvider, SearchResult } from "../../ipc/search";
import { isAppError } from "../../ipc/commands";
import { ProviderDialog } from "./ProviderDialog";
import type { ProviderFormData } from "./ProviderDialog";
import { listContainer, listItem } from "../../lib/motion";

// ── Types ────────────────────────────────────────────────────────────────────

interface DialogState {
  open: boolean;
  provider?: SearchProvider;
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Empty state shown when no providers are configured. */
function EmptyState({ onAddProvider }: { onAddProvider: () => void }) {
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
      <AuraButton variant="primary" onClick={onAddProvider}>
        + Add Provider
      </AuraButton>
    </AuraCard>
  );
}

/** A single result row rendered as a focusable link. */
function ResultRow({ result }: { result: SearchResult }) {
  async function handleOpen() {
    await openUrl(result.url);
  }

  return (
    <motion.li
      variants={listItem}
      style={{ listStyle: "none", margin: 0, padding: 0 }}
    >
      <button
        onClick={handleOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 14px",
          borderRadius: 8,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--aura-on-surface)",
          textAlign: "left",
          fontSize: 14,
          transition: "background var(--harmony-dur-fast) var(--harmony-ease-out)",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "var(--aura-surface-raised)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
        }
        onFocus={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "var(--aura-surface-raised)")
        }
        onBlur={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
        }
      >
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {result.title}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--aura-on-surface-muted)",
            flexShrink: 0,
          }}
        >
          ↗ open
        </span>
      </button>
    </motion.li>
  );
}

/** Provider chip toggle with edit/remove actions. */
function ProviderChip({
  provider,
  onToggle,
  onEdit,
  onRemove,
}: {
  provider: SearchProvider;
  onToggle: (id: number) => void;
  onEdit: (provider: SearchProvider) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 20,
        fontSize: 13,
        fontWeight: provider.enabled ? 600 : 400,
        border: `1.5px solid ${provider.enabled ? "var(--aura-primary)" : "var(--aura-on-surface-muted)"}`,
        background: provider.enabled
          ? "var(--harmony-provider-enabled-bg)"
          : "transparent",
        color: provider.enabled
          ? "var(--aura-primary)"
          : "var(--aura-on-surface-muted)",
        transition: "all 0.12s",
      }}
    >
      <button
        onClick={() => onToggle(provider.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          color: "inherit",
          fontSize: "inherit",
          fontWeight: "inherit",
        }}
        title={provider.enabled ? "Disable provider" : "Enable provider"}
      >
        {provider.enabled ? "✓ " : ""}
        {provider.name}
      </button>
      <button
        onClick={() => onEdit(provider)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--aura-on-surface-muted)",
          fontSize: 11,
        }}
        title="Edit provider"
      >
        ✎
      </button>
      <button
        onClick={() => onRemove(provider.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--aura-on-surface-muted)",
          fontSize: 12,
        }}
        title="Remove provider"
      >
        ×
      </button>
    </span>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function SearchPage() {
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const queryRef = useRef<HTMLElement>(null);

  // Load providers on mount.
  useEffect(() => {
    listProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  // Run search: collect results from enabled providers, grouped by provider.
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const active = providers.filter((p) => p.enabled);
    if (active.length === 0) return;

    setRunning(true);
    setSearchError(null);
    setResults(null);

    try {
      const all = await runSearch({ query: q });
      setResults(all);
    } catch (err) {
      const detail = isAppError(err) ? err.detail : String(err);
      setSearchError(detail);
    } finally {
      setRunning(false);
    }
  }, [query, providers]);

  // Keyboard: Enter in query field runs search.
  function handleQueryKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  // Provider management callbacks.
  async function handleToggle(id: number) {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    const updated = await updateProvider({ id, enabled: !p.enabled });
    setProviders((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }

  function handleEditOpen(provider: SearchProvider) {
    setDialog({ open: true, provider });
  }

  async function handleRemove(id: number) {
    await removeProvider({ id });
    setProviders((prev) => prev.filter((x) => x.id !== id));
  }

  async function handleDialogSave(data: ProviderFormData) {
    if (dialog.provider) {
      const updated = await updateProvider({
        id: dialog.provider.id,
        name: data.name,
        urlTemplate: data.urlTemplate,
      });
      setProviders((prev) =>
        prev.map((x) => (x.id === dialog.provider!.id ? updated : x))
      );
    } else {
      const created = await addProvider(data);
      setProviders((prev) => [...prev, created]);
    }
    setDialog({ open: false });
  }

  // Group results by providerId.
  const resultsByProvider = results
    ? providers.reduce<Record<number, SearchResult[]>>((acc, p) => {
        const group = results.filter((r) => r.providerId === p.id);
        if (group.length > 0) acc[p.id] = group;
        return acc;
      }, {})
    : {};

  const hasProviders = providers.length > 0;
  const activeCount = providers.filter((p) => p.enabled).length;

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}
      aria-label="File search"
    >
      {/* Header */}
      <h1 style={{ margin: 0, fontSize: 22 }}>Search</h1>

      {/* Query + run */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <AuraField
          ref={queryRef}
          name="search-query"
          type="search"
          value={query}
          placeholder="Search…"
          style={{ flex: 1 }}
          events={{
            "aura-field:input": (e) =>
              setQuery((e as CustomEvent<{ value: string }>).detail.value),
          }}
          onKeyDown={handleQueryKey as unknown as React.EventHandler<React.SyntheticEvent>}
        />
        <AuraButton
          variant="primary"
          onClick={handleSearch}
          disabled={!query.trim() || activeCount === 0 || running}
        >
          {running ? "Searching…" : "Search"}
        </AuraButton>
      </div>

      {/* Provider chips */}
      {hasProviders ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--aura-on-surface-muted)", marginRight: 2 }}>
            Providers:
          </span>
          {providers.map((p) => (
            <ProviderChip
              key={p.id}
              provider={p}
              onToggle={handleToggle}
              onEdit={handleEditOpen}
              onRemove={handleRemove}
            />
          ))}
          <AuraButton
            variant="ghost"
            style={{ fontSize: 13, padding: "4px 10px" }}
            onClick={() => setDialog({ open: true })}
          >
            + Add
          </AuraButton>
        </div>
      ) : (
        /* No providers configured → empty state */
        <EmptyState onAddProvider={() => setDialog({ open: true })} />
      )}

      {/* Search error */}
      {searchError && (
        <p style={{ margin: 0, color: "var(--aura-error)", fontSize: 14 }}>
          Search failed: {searchError}
        </p>
      )}

      {/* Results */}
      {results !== null && (
        <AuraCard
          class="harmony-panel"
          style={{ padding: 0, overflow: "hidden" }}
        >
          {results.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: "20px 16px",
                color: "var(--aura-on-surface-muted)",
                fontSize: 14,
              }}
            >
              No results for "{query}".
            </p>
          ) : (
            /* Grouped by provider */
            Object.entries(resultsByProvider).map(([pId, group]) => {
              const pName =
                providers.find((p) => p.id === Number(pId))?.name ?? "Provider";
              return (
                <div key={pId}>
                  <h3
                    style={{
                      margin: 0,
                      padding: "12px 16px 4px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    {pName}
                  </h3>
                  <AnimatePresence>
                    <motion.ul
                      variants={listContainer}
                      initial="hidden"
                      animate="visible"
                      style={{ listStyle: "none", margin: 0, padding: "0 4px 8px" }}
                    >
                      {group.map((r) => (
                        <ResultRow key={r.url} result={r} />
                      ))}
                    </motion.ul>
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </AuraCard>
      )}

      {/* Add / Edit provider dialog */}
      <ProviderDialog
        open={dialog.open}
        provider={dialog.provider}
        onSave={handleDialogSave}
        onClose={() => setDialog({ open: false })}
      />
    </section>
  );
}
