/**
 * ProviderCatalog — discover & add providers (v0.20, refreshed v0.45).
 *
 * Simple, responsive gallery: All · Games · ROMs · Reference chips, plain
 * language copy, ROM archives surfaced first, one-click add with DD/priority
 * from the catalog entry when suggested.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { AuraDialog, AuraButton, AuraField } from "@aura/react";
import { dialogPop } from "../../lib/motion";
import { listProviderCatalog, addProvider } from "../../ipc/search";
import type { CatalogProvider, SearchProvider } from "../../ipc/search";
import { isAppError } from "../../ipc/commands";
import { swallow } from "../../ipc/swallow";
import { useController } from "../controller";

interface ProviderCatalogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the created provider after a successful add. */
  onAdded: (provider: SearchProvider) => void;
}

type SimpleFilter = "All" | "Games" | "ROMs" | "Reference";

const SIMPLE_FILTERS: SimpleFilter[] = ["All", "Games", "ROMs", "Reference"];

function matchesSimpleFilter(entry: CatalogProvider, filter: SimpleFilter): boolean {
  if (filter === "All") return true;
  if (filter === "ROMs") return entry.media === "ROM archives";
  if (filter === "Reference") return entry.kind === "reference";
  // Games: download sources that aren't pure reference
  return entry.kind === "download" && entry.media !== "ROM archives";
}

/** A small filter chip. */
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
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        minHeight: 32,
        borderRadius: 20,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        border: `1.5px solid ${active ? "var(--aura-primary)" : "var(--aura-on-surface-muted)"}`,
        background: active ? "var(--rgp-provider-enabled-bg)" : "transparent",
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
        flexWrap: "wrap",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 4px",
        borderTop: "1px solid var(--aura-outline-subtle, transparent)",
      }}
    >
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
          {entry.suggestDirectDownload && (
            <span
              title="Direct download into your library is available"
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--aura-primary)",
                border: "1px solid var(--aura-primary)",
                borderRadius: 4,
                padding: "1px 5px",
              }}
            >
              download
            </span>
          )}
          {entry.jsRendered && (
            <span
              title="This site is JavaScript-rendered — the preview can't read it yet."
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
            margin: "4px 0 0",
            fontSize: 12,
            color: "var(--aura-on-surface-muted)",
            lineHeight: 1.35,
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
            paddingTop: 4,
          }}
        >
          ✓ Included
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
  const [simple, setSimple] = useState<SimpleFilter>("All");
  const [addingName, setAddingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { claimExclusive } = useController();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return claimExclusive((action) => {
      if (action === "back" || action === "quit") onCloseRef.current();
    }, "ui");
  }, [open, claimExclusive]);

  useEffect(() => {
    if (!open) return;
    setFilter("");
    setSimple("All");
    setError(null);
    listProviderCatalog()
      .then(setEntries)
      .catch((err: unknown) => {
        setEntries([]);
        swallow(err, "ProviderCatalog.load");
      });
  }, [open]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries
      .filter((e) => matchesSimpleFilter(e, simple))
      .filter((e) => {
        if (!q) return true;
        return (
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.media.toLowerCase().includes(q)
        );
      });
  }, [entries, filter, simple]);

  async function handleAdd(entry: CatalogProvider) {
    setAddingName(entry.name);
    setError(null);
    try {
      const created = await addProvider({
        name: entry.name,
        urlTemplate: entry.urlTemplate,
        kind: entry.kind,
        directDownload: entry.suggestDirectDownload,
        priority: entry.priority,
      });
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
      class="rgp-provider-catalog"
      open
      style={
        {
          "--aura-dialog-width": "min(560px, 92vw)",
        } as React.CSSProperties
      }
    >
      <motion.div
        initial={dialogPop.initial}
        animate={dialogPop.animate}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 4,
          maxHeight: "min(80vh, 640px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>Game sources</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--aura-on-surface-muted)",
              minWidth: 36,
              minHeight: 36,
            }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)", lineHeight: 1.4 }}>
          Sources Retro Game Player searches when you look for games.{" "}
          <strong>ROMs</strong> are research archives (often already included).
          Reference sites are for info only. Add anything missing in one click.
        </p>

        <AuraField>
          <input
            name="catalog-filter"
            className="rgp-input"
            type="search"
            value={filter}
            placeholder="Search sources…"
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </AuraField>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SIMPLE_FILTERS.map((m) => (
            <MediaChip
              key={m}
              label={m}
              active={simple === m}
              onClick={() => setSimple(m)}
            />
          ))}
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-error)" }}>{error}</p>
        )}

        <ul
          role="list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            flex: 1,
            minHeight: 120,
            maxHeight: "min(50vh, 360px)",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {visible.length === 0 ? (
            <li style={{ padding: "16px 4px", fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
              No sources match.
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
