// FamiliarPane — the Settings "Familiar" section (optional AI enrichment service).

import { useState, useEffect } from "react";
import { AuraField } from "@aura/react";

import { probeFamiliar, saveFamiliarConfig, type FamiliarProbe } from "../../../ipc/familiar";
import { LocateToolPane, locateToolInputStyle } from "./LocateToolPane";

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
    <LocateToolPane
      title="Familiar Connection"
      description="Optional AI enrichment service. The API key is stored in the system Keychain — it is never written to disk or sent over IPC in plaintext after being saved."
      error={error}
      fieldLabel="Base URL"
      saving={saving}
      saved={saved}
      onSave={() => { void handleSave(); }}
      fieldInput={
        <input
          type="url"
          placeholder="https://familiar.example.com"
          value={baseUrl}
          tabIndex={0}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
          style={locateToolInputStyle}
        />
      }
    >
      {probe && (
        <div
          className="rgp-panel"
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

      <AuraField label="API Key" tabIndex={0}>
        <input
          type="password"
          placeholder="sk-…  (sent to Keychain, not stored here)"
          autoComplete="new-password"
          value={apiKey}
          tabIndex={0}
          onChange={(e) => setApiKey(e.currentTarget.value)}
          style={locateToolInputStyle}
        />
      </AuraField>
    </LocateToolPane>
  );
}
