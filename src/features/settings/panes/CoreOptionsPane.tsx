// CoreOptionsPane — the Settings "Core Options" section (v0.29 W282,
// core-options-design.md). Lists the active native-hosted core's declared
// libretro options, one row per option with the control archetype
// `classifyControl` picks (bool toggle / numeric range / enum select),
// writing through to the new core-options IPC commands. Options apply on the
// next boot — no hot-reload requirement for v1.
//
// Native FFI-hosted cores ONLY (currently `fceumm` NES, `NATIVE_SYSTEM`):
// RetroArch-external-launch and EmulatorJS-hosted systems get no entry point
// here by design — `useCoreOptions` surfaces that as `unsupported` and this
// pane renders nothing but an explanatory note rather than a broken control
// list.

import { AuraButton, AuraField } from "@aura/react";
import { NATIVE_SYSTEM } from "../../play/nativePath";
import { useCoreOptions } from "../../core-options/useCoreOptions";
import { classifyControl, numericSteps } from "../../core-options/controlKind";
import type { CoreOption } from "../../../ipc/core-options";

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

/** One option row: the control archetype matching its declared choices. */
function OptionRow({
  option,
  saving,
  error,
  onChange,
}: {
  option: CoreOption;
  saving: boolean;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const kind = classifyControl(option.choices);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <AuraField label={option.description} tabIndex={0}>
        {kind === "bool" && (
          <AuraButton
            tabIndex={0}
            variant={isEnabledChoice(option.value) ? "secondary" : "ghost"}
            disabled={saving}
            onClick={() => onChange(otherChoice(option))}
          >
            {saving ? "Saving…" : option.value}
          </AuraButton>
        )}

        {kind === "range" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range"
              tabIndex={0}
              disabled={saving}
              min={0}
              max={numericSteps(option.choices).length - 1}
              step={1}
              value={rangeIndex(option)}
              aria-label={option.description}
              onChange={(e) => {
                const steps = numericSteps(option.choices);
                const idx = Number(e.target.value);
                onChange(String(steps[idx] ?? steps[0]));
              }}
            />
            <span style={{ fontSize: 13, minWidth: 32, textAlign: "right" }}>
              {option.value}
            </span>
          </div>
        )}

        {kind === "select" && (
          <select
            className="rgp-input"
            style={{ ...inputStyle, maxWidth: 280 }}
            tabIndex={0}
            disabled={saving}
            value={option.value}
            onChange={(e) => onChange(e.target.value)}
          >
            {option.choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        )}
      </AuraField>
      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 12 }}>{error}</p>
      )}
    </div>
  );
}

/** True when `value` is the "on" side of a recognized boolean-style pair. */
function isEnabledChoice(value: string): boolean {
  const lower = value.toLowerCase();
  return lower === "enabled" || lower === "on" || lower === "true" || lower === "yes";
}

/** The other choice in a two-way bool option — toggling `value` flips it. */
function otherChoice(option: CoreOption): string {
  return option.choices.find((c) => c !== option.value) ?? option.value;
}

/** The slider index for the option's current value among its sorted numeric steps. */
function rangeIndex(option: CoreOption): number {
  const steps = numericSteps(option.choices);
  const idx = steps.indexOf(Number(option.value));
  return idx >= 0 ? idx : 0;
}

export function CoreOptionsPane() {
  const { options, loading, fetchError, unsupported, saveState, saveError, setValue } =
    useCoreOptions(NATIVE_SYSTEM);

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Core Options</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Per-core settings for the natively-hosted {NATIVE_SYSTEM.toUpperCase()} core.
        Changes apply the next time you start a game.
      </p>

      {unsupported && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
          Install the {NATIVE_SYSTEM.toUpperCase()} core from the Cores screen to configure its options.
        </p>
      )}

      {!unsupported && fetchError && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>{fetchError}</p>
      )}

      {loading && !fetchError && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
          Loading options…
        </p>
      )}

      {!loading && !fetchError && options.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
          This core declares no configurable options.
        </p>
      )}

      {!loading &&
        !fetchError &&
        options.map((option) => (
          <OptionRow
            key={option.key}
            option={option}
            saving={saveState(option.key) === "saving"}
            error={saveError(option.key)}
            onChange={(value) => {
              void setValue(option.key, value);
            }}
          />
        ))}
    </div>
  );
}
