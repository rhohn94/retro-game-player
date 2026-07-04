// CrtFilterPane — the Settings "CRT Filter" section (v0.29 W280,
// crt-filter-design.md). Sliders for the four effect intensities plus the
// four named presets, with a live preview (CrtFilterPreview) showing both
// play paths side by side. Persists through the shared useCrtFilter hook —
// the same config both NativePlayer's WebGL2 shader and InPagePlayer's CSS
// overlay read, so a change here applies identically regardless of which
// path a given game uses.

import { AuraButton, AuraField } from "@aura/react";
import { useCrtFilter } from "../../play/useCrtFilter";
import { CRT_PRESET_LIST } from "../../play/crtFilter";
import { CrtFilterPreview } from "./CrtFilterPreview";

const SLIDERS: { key: "scanlines" | "curvature" | "colorBleed" | "vignette"; label: string }[] = [
  { key: "scanlines", label: "Scanlines" },
  { key: "curvature", label: "Curvature" },
  { key: "colorBleed", label: "Color bleed" },
  { key: "vignette", label: "Vignette" },
];

export function CrtFilterPane() {
  const { config, ready, setIntensity, setPreset } = useCrtFilter();

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>CRT Filter</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        A retro CRT presentation layer — scanlines, screen curvature, color
        bleed, and vignette — applied on top of every game, on both play
        paths. The native path renders it through a real shader; the
        in-page (EmulatorJS) path shows a close CSS approximation.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {CRT_PRESET_LIST.map((p) => (
          <AuraButton
            key={p.id}
            tabIndex={0}
            variant={config.preset === p.id ? "secondary" : "ghost"}
            disabled={!ready}
            aria-pressed={config.preset === p.id}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </AuraButton>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SLIDERS.map(({ key, label }) => (
          <AuraField key={key} label={label} tabIndex={0}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="range"
                tabIndex={0}
                disabled={!ready}
                min={0}
                max={100}
                step={1}
                value={config[key]}
                aria-label={label}
                onChange={(e) => setIntensity(key, Number(e.target.value))}
              />
              <span style={{ fontSize: 13, minWidth: 36, textAlign: "right" }}>{config[key]}%</span>
            </div>
          </AuraField>
        ))}
      </div>

      <h4 style={{ margin: "8px 0 0" }}>Live preview</h4>
      <CrtFilterPreview config={config} />
    </div>
  );
}
