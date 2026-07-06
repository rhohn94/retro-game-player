// RetroAchievementsPane — the Settings "RetroAchievements" section (v0.37
// W371, retroachievements-design.md §Client + accounts). Optional account:
// username + Web API key unlock native-path achievement tracking (NES/SNES,
// W370/W372). Follows the SteamGridDbSection/FamiliarPane pane pattern —
// plain `<input>` fields inside `AuraField` (never value/type props on the
// field itself, per the Aura interaction contract), a Save action that
// persists the credential, and a separate Validate action that checks it
// against the real API and surfaces connection status. No credential ⇒ the
// backend never makes a network call (`validateRetroAchievementsAccount`
// resolves to `notConfigured` instead of erroring).

import { useEffect, useState } from "react";
import { AuraButton, AuraField } from "@aura/react";

import {
  getRetroAchievementsAccount,
  saveRetroAchievementsAccount,
  validateRetroAchievementsAccount,
  type RetroAchievementsValidation,
} from "../../../ipc/retroachievements";
import { swallow } from "../../../ipc/swallow";

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

/** Human-readable connection status line for a validation outcome. */
function statusLabel(validation: RetroAchievementsValidation | null, hasKey: boolean): string {
  if (!validation || validation.status === "notConfigured") {
    return hasKey ? "Not validated yet." : "No account configured — the achievements feature is inert.";
  }
  if (validation.status === "valid") return "Connected.";
  return `Invalid credential${validation.message ? `: ${validation.message}` : ""}.`;
}

export function RetroAchievementsPane() {
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<RetroAchievementsValidation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRetroAchievementsAccount()
      .then((status) => {
        setUsername(status.username ?? "");
        setHasKey(status.hasKey);
      })
      .catch((e: unknown) => swallow(e, "RetroAchievementsPane.load"));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setValidation(null);
    try {
      await saveRetroAchievementsAccount({
        username: username.trim() === "" ? "" : username.trim(),
        apiKey: apiKey.trim() === "" ? null : apiKey.trim(),
      });
      setApiKey(""); // never keep the key in state after it's sent
      const updated = await getRetroAchievementsAccount();
      setUsername(updated.username ?? "");
      setHasKey(updated.hasKey);
      // Auto-validate right after a successful save (issue #34 §6): Save
      // used to leave the status line at "Not validated yet." until the user
      // pressed the separate Validate button by hand, even though the whole
      // point of saving a credential is to find out whether it actually
      // works. Folding one validation call into Save removes that extra click
      // for the common path; the dedicated Validate button stays (re-checking
      // a PREVIOUSLY saved credential, e.g. after RA-side account changes,
      // needs no new save). Skipped when the account was cleared (no key on
      // file) — matches `validateRetroAchievementsAccount`'s own
      // `notConfigured` short-circuit, so this never fires a network call the
      // backend would reject anyway.
      if (updated.hasKey) {
        const result = await validateRetroAchievementsAccount();
        setValidation(result);
      }
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setError(null);
    try {
      const result = await validateRetroAchievementsAccount();
      setValidation(result);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>RetroAchievements</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Optional account for tracking RetroAchievements unlocks on NES/SNES
        native-hosted games. Leave both fields blank to leave this feature
        off — the achievement runtime, hashing, and unlock tracking all stay
        fully inert without a configured account.
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <div
        className="rgp-panel"
        style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13 }}
      >
        Status: <strong>{statusLabel(validation, hasKey)}</strong>
      </div>

      <AuraField label="Username" tabIndex={0}>
        <input
          type="text"
          placeholder="RetroAchievements username"
          tabIndex={0}
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          style={inputStyle}
        />
      </AuraField>

      <AuraField label="Web API Key" tabIndex={0}>
        <input
          type="password"
          placeholder={hasKey ? "•••••••• (already saved to the system Keychain)" : "Web API key from your RA settings page"}
          tabIndex={0}
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
          style={inputStyle}
        />
      </AuraField>
      {hasKey && apiKey.trim() === "" && (
        // Clarifies the placeholder above (issue #34 §6): the prior copy
        // ("sent to Keychain, not stored here") read as an in-progress
        // action, not a completed-and-at-rest one — easy to misread as "your
        // key is being sent somewhere right now" rather than "it already
        // lives in the OS Keychain, and this app never keeps a plaintext
        // copy of it". This line only shows once a key is actually on file
        // and the field is empty (i.e. showing the placeholder), so it never
        // talks about the Keychain while the user is mid-edit of a new key.
        <p style={{ margin: 0, fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
          Your Web API key is stored in the system Keychain, not in this
          app's own settings — leave this field blank to keep the saved key.
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AuraButton tabIndex={0} disabled={saving} onClick={() => { void handleSave(); }}>
          {saving ? "Saving…" : "Save"}
        </AuraButton>
        <AuraButton
          tabIndex={0}
          variant="secondary"
          disabled={validating || (!hasKey && apiKey.trim() === "")}
          onClick={() => { void handleValidate(); }}
        >
          {validating ? "Validating…" : "Validate"}
        </AuraButton>
      </div>
    </div>
  );
}
