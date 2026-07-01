// ProvidersPane — the Settings "Providers" section (search provider management).

import { useCallback, useEffect, useState } from "react";
import { AuraButton, AuraField } from "@aura/react";

import {
  addProvider,
  listProviders,
  removeProvider,
  updateProvider,
  type SearchProvider,
} from "../../../ipc/search";

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

export function ProvidersPane() {
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [addTemplate, setAddTemplate] = useState("");

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
      setProviders((prev) => [...prev, p]);
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

  async function handleRemove(id: number) {
    try {
      await removeProvider({ id });
      setProviders((prev) => prev.filter((p) => p.id !== id));
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Search Providers</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        URL templates must include <code>{"{query}"}</code>. Results open in the
        system browser — no server-side fetching.
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <div
        className="harmony-panel"
        style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 8 }}
      >
        <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>Add provider</p>
        <div style={{ display: "flex", gap: 8 }}>
          <AuraField tabIndex={0} style={{ flex: 1 }}>
            <input
              type="text"
              placeholder="Name"
              tabIndex={0}
              value={addName}
              onChange={(e) => setAddName(e.currentTarget.value)}
              style={inputStyle}
            />
          </AuraField>
          <AuraField tabIndex={0} style={{ flex: 2 }}>
            <input
              type="text"
              placeholder="https://example.com/search?q={query}"
              tabIndex={0}
              value={addTemplate}
              onChange={(e) => setAddTemplate(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
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
            No providers configured.
          </p>
        )}
        {providers.map((p) => (
          <div
            key={p.id}
            className="harmony-panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 8,
            }}
          >
            <span style={{ fontWeight: 500, minWidth: 100, fontSize: 13 }}>{p.name}</span>
            <span
              style={{
                flex: 1,
                fontSize: 12,
                color: "var(--aura-on-surface-muted)",
                wordBreak: "break-all",
              }}
            >
              {p.urlTemplate}
            </span>
            <AuraButton
              tabIndex={0}
              variant={p.enabled ? "secondary" : "ghost"}
              onClick={() => { void handleToggle(p); }}
            >
              {p.enabled ? "Enabled" : "Disabled"}
            </AuraButton>
            <AuraButton
              tabIndex={0}
              variant="ghost"
              onClick={() => { void handleRemove(p.id); }}
            >
              Remove
            </AuraButton>
          </div>
        ))}
      </div>
    </div>
  );
}
