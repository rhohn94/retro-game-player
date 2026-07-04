// SettingsPage — the Settings screen for Retro Game Player (W15).
//
// Archetype: Sectioned-form (harmony-ux-design.md §3). Two-column layout:
// left <aura-nav> section list, right pane renders the selected section.
// Controller-operable structure: focusable elements use tabIndex so W14's
// spatial-nav engine can move between them. Each section reads/writes via its
// domain IPC wrapper — no raw `invoke` calls here.
//
// Sections: Folders | Cores | Core Options | Controllers | Providers |
// Familiar | Playback | CRT Filter | Performance | Appearance | RetroArch —
// each implemented in ./panes/, this file is the two-column shell +
// SectionPane switch. (Controllers hosts the full press-to-rebind editor —
// W267, controller-input-design.md §Remapping UI. Core Options — v0.29 W282,
// core-options-design.md — lists the active native-hosted core's declared
// libretro options; it renders an explanatory note rather than controls when
// no native-hosted core applies, so the section itself is always listed but
// never a broken entry point. CRT Filter — v0.29 W280, crt-filter-design.md —
// scanline/curvature/color-bleed/vignette sliders + presets, applied
// identically to both play paths via the shared useCrtFilter config.
// Performance — v0.29 W281, performance-tooling-design.md — reads both
// perf-log files via IPC and renders recent sessions as a table + sparkline.)

import { useState } from "react";

import { FoldersPane } from "./panes/FoldersPane";
import { CoresPane } from "./panes/CoresPane";
import { CoreOptionsPane } from "./panes/CoreOptionsPane";
import { ControllersPane } from "./panes/ControllersPane";
import { ProvidersPane } from "./panes/ProvidersPane";
import { FamiliarPane } from "./panes/FamiliarPane";
import { PlaybackPane } from "./panes/PlaybackPane";
import { CrtFilterPane } from "./panes/CrtFilterPane";
import { PerformancePane } from "./panes/PerformancePane";
import { AppearancePane } from "./panes/AppearancePane";
import { RetroArchPane } from "./panes/RetroArchPane";

// ── Section identifiers ───────────────────────────────────────────────────────

type SectionId =
  | "folders"
  | "cores"
  | "core-options"
  | "controllers"
  | "providers"
  | "familiar"
  | "playback"
  | "crt-filter"
  | "performance"
  | "appearance"
  | "retroarch";

interface Section {
  id: SectionId;
  label: string;
}

const SECTIONS: Section[] = [
  { id: "folders", label: "Folders" },
  { id: "cores", label: "Cores" },
  { id: "core-options", label: "Core Options" },
  { id: "controllers", label: "Controllers" },
  { id: "providers", label: "Providers" },
  { id: "familiar", label: "Familiar" },
  { id: "playback", label: "Playback" },
  { id: "crt-filter", label: "CRT Filter" },
  { id: "performance", label: "Performance" },
  { id: "appearance", label: "Appearance" },
  { id: "retroarch", label: "RetroArch" },
];

/** Render the active section pane. */
function SectionPane({ id, onNavigate }: { id: SectionId; onNavigate: (id: SectionId) => void }) {
  switch (id) {
    case "folders":
      return <FoldersPane />;
    case "cores":
      return <CoresPane onOpenCoreOptions={() => onNavigate("core-options")} />;
    case "core-options":
      return <CoreOptionsPane />;
    case "controllers":
      return <ControllersPane />;
    case "providers":
      return <ProvidersPane />;
    case "familiar":
      return <FamiliarPane />;
    case "playback":
      return <PlaybackPane />;
    case "crt-filter":
      return <CrtFilterPane />;
    case "performance":
      return <PerformancePane />;
    case "appearance":
      return <AppearancePane />;
    case "retroarch":
      return <RetroArchPane />;
  }
}

/**
 * Settings screen — two-column sectioned-form archetype.
 * Left: <aura-nav>-style section list. Right: active section pane.
 * Controller-operable: tabIndex on nav items and pane fields.
 */
export function SettingsPage() {
  const [active, setActive] = useState<SectionId>("folders");

  return (
    <section
      className="rgp-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderRadius: 12,
        overflow: "hidden",
        minHeight: 480,
      }}
    >
      <header style={{ padding: "16px 24px 12px", borderBottom: "1px solid var(--aura-border)" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Settings</h2>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Section nav — left column. A tablist (switches which pane shows
            within this same page), not real page navigation, so ARIA tab
            roles give a screen reader the right semantics (W283). */}
        <nav
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
          style={{
            width: 160,
            padding: "12px 8px",
            borderRight: "1px solid var(--aura-border)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              id={`settings-tab-${s.id}`}
              role="tab"
              aria-selected={active === s.id}
              aria-controls={`settings-panel-${s.id}`}
              tabIndex={0}
              onClick={() => setActive(s.id)}
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                background:
                  active === s.id
                    ? "var(--aura-primary)"
                    : "transparent",
                color:
                  active === s.id
                    ? "var(--aura-on-primary)"
                    : "var(--aura-on-surface)",
                fontWeight: active === s.id ? 600 : 400,
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Active section pane — right column */}
        <div
          id={`settings-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${active}`}
          tabIndex={0}
          style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}
        >
          <SectionPane id={active} onNavigate={setActive} />
        </div>
      </div>
    </section>
  );
}
