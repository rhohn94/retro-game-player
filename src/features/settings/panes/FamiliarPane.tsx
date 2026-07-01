// FamiliarPane — the Settings "Familiar" section (optional AI enrichment service).

import { useState, useEffect } from "react";
import { AuraButton, AuraField } from "@aura/react";

import { probeFamiliar, saveFamiliarConfig, type FamiliarProbe } from "../../../ipc/familiar";

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

export function FamiliarPane() {
  const [probe, setProbe] = useState<FamiliarProbe | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    probeFamiliar()
      .then((p) => {
        setProbe(p);
        setBaseUrl(p.baseUrl ?? "");
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // The key is intentionally never stored client-side (W12 contract) — it
      // goes straight to the Keychain via the backend.
      await saveFamiliarConfig({
        baseUrl: baseUrl.trim() || null,
        apiKey: apiKey.trim() || null,
      });
      setApiKey(""); // clear after send — never keep in state
      const updated = await probeFamiliar();
      setProbe(updated);
      setSaved(true);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Familiar Connection</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Optional AI enrichment service. The API key is stored in the system
        Keychain — it is never written to disk or sent over IPC in plaintext after
        being saved.
      </p>

      {probe && (
        <div
          className="harmony-panel"
          style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13 }}
        >
          Status:{" "}
          <strong>
            {probe.authorized
              ? "Connected"
              : probe.present
                ? "Reachable (not authorized)"
                : "Unreachable"}
          </strong>
          {probe.capabilities.length > 0 && (
            <span style={{ color: "var(--aura-on-surface-muted)", marginLeft: 8 }}>
              · {probe.capabilities.join(", ")}
            </span>
          )}
        </div>
      )}

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <AuraField label="Base URL" tabIndex={0}>
        <input
          type="url"
          placeholder="https://familiar.example.com"
          value={baseUrl}
          tabIndex={0}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
          style={inputStyle}
        />
      </AuraField>

      <AuraField label="API Key" tabIndex={0}>
        <input
          type="password"
          placeholder="sk-…  (sent to Keychain, not stored here)"
          value={apiKey}
          tabIndex={0}
          onChange={(e) => setApiKey(e.currentTarget.value)}
          style={inputStyle}
        />
      </AuraField>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AuraButton
          tabIndex={0}
          disabled={saving}
          onClick={() => { void handleSave(); }}
        >
          {saving ? "Saving…" : "Save"}
        </AuraButton>
        {saved && (
          <span style={{ fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}
