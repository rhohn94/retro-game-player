// ProvidersPane — Settings "Providers" section with discovery parity (v0.45).
// Kind badge, direct-download toggle, enable/remove, Browse sources catalog.

import { useCallback, useEffect, useState } from "react";
import { AuraButton, AuraField } from "@aura/react";

import {
  addProvider,
  listProviders,
  removeProvider,
  updateProvider,
  type SearchProvider,
} from "../../../ipc/search";
import { ProviderCatalog } from "../../search/ProviderCatalog";

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderRadius: 4,
  padding: "2px 6px",
  border: "1px solid var(--aura-on-surface-muted)",
  color: "var(--aura-on-surface-muted)",
  whiteSpace: "nowrap",
};

export function ProvidersPane() {
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [addTemplate, setAddTemplate] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);

  const load = useCallback(() => {
    listProviders()
      .then(setProviders)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    if (!addName.trim() || !addTemplate.trim()) return;
    if (!addTemplate.includes("{query}")) {
      setError("URL template must contain {query}");
      return;
    }
    try {
      const p = await addProvider({ name: addName.trim(), urlTemplate: addTemplate.trim() });
      setProviders((prev) => [...prev, p].sort((a, b) => a.priority - b.priority || a.id - b.id));
      setAddName("");
      setAddTemplate("");
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function handleToggle(p: SearchProvider) {
    try {
      const updated = await updateProvider({ id: p.id, enabled: !p.enabled });
      setProviders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function handleToggleDd(p: SearchProvider) {
    try {
      const updated = await updateProvider({
        id: p.id,
        directDownload: !p.directDownload,
      });
      setProviders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function handleRemove(id: number) {
    try {
      await removeProvider({ id });
      setProviders((prev) => prev.filter((p) => p.id !== id));
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  const romCount = providers.filter((p) => p.priority <= 10 && p.enabled).length;
  const ddCount = providers.filter((p) => p.directDownload && p.enabled).length;

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Game sources</h3>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
            Where Retro Game Player looks when you search for games.{" "}
            <strong>{romCount}</strong> ROM archive{romCount === 1 ? "" : "s"} active ·{" "}
            <strong>{ddCount}</strong> with direct download.
          </p>
        </div>
        <AuraButton tabIndex={0} variant="primary" onClick={() => setCatalogOpen(true)}>
          Browse sources
        </AuraButton>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Templates need <code>{"{query}"}</code>. Search previews result links; providers with
        direct download can land a file in your library when you click ⬇.
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>{error}</p>
      )}

      <div
        className="rgp-panel"
        style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 8 }}
      >
        <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>Add custom source</p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "flex-end",
          }}
        >
          <AuraField label="Name" tabIndex={0} style={{ flex: "1 1 120px", minWidth: 100 }}>
            <input
              type="text"
              placeholder="Name"
              tabIndex={0}
              value={addName}
              onChange={(e) => setAddName(e.currentTarget.value)}
              style={inputStyle}
            />
          </AuraField>
          <AuraField label="URL Template" tabIndex={0} style={{ flex: "2 1 200px", minWidth: 160 }}>
            <input
              type="url"
              placeholder="https://example.com/search?q={query}"
              tabIndex={0}
              value={addTemplate}
              onChange={(e) => setAddTemplate(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
              style={inputStyle}
            />
          </AuraField>
          <AuraButton tabIndex={0} onClick={() => { void handleAdd(); }}>
            Add
          </AuraButton>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {providers.length === 0 && (
          <p style={{ color: "var(--aura-on-surface-muted)", margin: 0, fontSize: 13 }}>
            No sources configured. Use Browse sources to add some.
          </p>
        )}
        {providers.map((p) => (
          <div
            key={p.id}
            className="rgp-panel"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: 8,
            }}
          >
            <div style={{ flex: "1 1 160px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</span>
                <span style={badgeStyle}>
                  {p.priority <= 10 ? "ROM" : p.kind === "download" ? "download" : "reference"}
                </span>
                {p.directDownload && (
                  <span
                    style={{
                      ...badgeStyle,
                      color: "var(--aura-primary)",
                      borderColor: "var(--aura-primary)",
                    }}
                  >
                    DD
                  </span>
                )}
              </div>
              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 12,
                  color: "var(--aura-on-surface-muted)",
                  wordBreak: "break-all",
                }}
              >
                {p.urlTemplate}
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <AuraButton
                tabIndex={0}
                variant={p.enabled ? "secondary" : "ghost"}
                onClick={() => { void handleToggle(p); }}
              >
                {p.enabled ? "On" : "Off"}
              </AuraButton>
              <AuraButton
                tabIndex={0}
                variant={p.directDownload ? "secondary" : "ghost"}
                onClick={() => { void handleToggleDd(p); }}
                title="Allow direct download into your library"
              >
                {p.directDownload ? "Download on" : "Download off"}
              </AuraButton>
              <AuraButton
                tabIndex={0}
                variant="ghost"
                onClick={() => { void handleRemove(p.id); }}
              >
                Remove
              </AuraButton>
            </div>
          </div>
        ))}
      </div>

      <ProviderCatalog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onAdded={(created) => {
          setProviders((prev) => {
            if (prev.some((p) => p.id === created.id)) return prev;
            return [...prev, created].sort(
              (a, b) => a.priority - b.priority || a.id - b.id
            );
          });
        }}
      />
    </div>
  );
}
