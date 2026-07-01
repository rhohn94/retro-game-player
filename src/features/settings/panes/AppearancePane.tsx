// AppearancePane — the Settings "Appearance" section (theme selection).

import { AuraButton, AuraField } from "@aura/react";
import { useAuraTheme } from "../../../theme/AuraProvider";
import { NAMED_THEMES } from "../../../theme/tokens";

export function AppearancePane() {
  const { theme, themes, setTheme } = useAuraTheme();

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Appearance</h3>

      <AuraField label="Theme" tabIndex={0}>
        <select
          className="harmony-input"
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
                  background: "var(--harmony-selected-bg)",
                  color: "var(--harmony-selected-fg)",
                  borderColor: "var(--harmony-selected-border)",
                }),
              }}
            >
              {t.label}
            </AuraButton>
          );
        })}
      </div>
    </div>
  );
}
