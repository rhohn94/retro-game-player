// AppearancePane — the Settings "Appearance" section (theme selection; the
// "Start in TV mode" auto-enter toggle added by v0.26 W260,
// tv-mode-design.md §Auto-enter).

import { useEffect, useState } from "react";
import { AuraButton, AuraField } from "@aura/react";
import { useAuraTheme } from "../../../theme/AuraProvider";
import { NAMED_THEMES } from "../../../theme/tokens";
import { getAutoTvMode, setAutoTvMode } from "../../../ipc/app-config";

/** The "Start in TV mode" toggle (v0.26 W260) — mirrors the on/off AuraButton
 * pattern PlaybackPane already uses for `native_play_enabled`/`pause_on_blur`,
 * so every boolean AppConfig toggle in Settings looks and behaves the same. */
function TvModeStartupToggle() {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAutoTvMode()
      .then(setEnabledState)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  async function handleToggle() {
    if (enabled === null) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      await setAutoTvMode(next);
      setEnabledState(next);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Land directly in the TV / leanback home on launch instead of the
        desktop library.
      </p>
      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>{error}</p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AuraButton
          tabIndex={0}
          variant={enabled ? "secondary" : "ghost"}
          disabled={enabled === null || saving}
          aria-pressed={enabled === true}
          onClick={() => {
            void handleToggle();
          }}
        >
          {enabled ? "Start in TV mode: on" : "Start in TV mode: off"}
        </AuraButton>
      </div>
    </div>
  );
}

export function AppearancePane() {
  const { theme, themes, setTheme } = useAuraTheme();

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Appearance</h3>

      <AuraField label="Theme" tabIndex={0}>
        <select
          className="rgp-input"
          style={{ maxWidth: 280 }}
          tabIndex={0}
          value={theme.className}
          onChange={(e) => {
            const val = e.target.value;
            if (val) setTheme(val);
          }}
        >
          {themes.map((t) => (
            <option key={t.className} value={t.className}>
              {t.label}
            </option>
          ))}
        </select>
      </AuraField>

      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        The selected theme persists across restarts. Changing it takes effect
        immediately.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {NAMED_THEMES.map((t) => {
          const selected = theme.className === t.className;
          return (
            <AuraButton
              key={t.className}
              variant={selected ? undefined : "ghost"}
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => setTheme(t.className)}
              style={{
                fontSize: 13,
                ...(selected && {
                  background: "var(--rgp-selected-bg)",
                  color: "var(--rgp-selected-fg)",
                  borderColor: "var(--rgp-selected-border)",
                }),
              }}
            >
              {t.label}
            </AuraButton>
          );
        })}
      </div>

      <h3 style={{ margin: "8px 0 0" }}>TV mode</h3>
      <TvModeStartupToggle />
    </div>
  );
}
