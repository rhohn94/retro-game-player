// SettingsPage — the Settings screen for Harmony (W15).
//
// Archetype: Sectioned-form (harmony-ux-design.md §3). Two-column layout:
// left <aura-nav> section list, right pane renders the selected section.
// Controller-operable structure: focusable elements use tabIndex so W14's
// spatial-nav engine can move between them. Each section reads/writes via its
// domain IPC wrapper — no raw `invoke` calls here.
//
// Sections: Folders | Cores | Controllers | Providers | Familiar | Playback |
// Appearance | RetroArch — each implemented in ./panes/, this file is the
// two-column shell + SectionPane switch.
// (Controllers surface is a stub placeholder — the binding editor is W14.)

import { useState } from "react";

import { FoldersPane } from "./panes/FoldersPane";
import { CoresPane } from "./panes/CoresPane";
import { ControllersPane } from "./panes/ControllersPane";
import { ProvidersPane } from "./panes/ProvidersPane";
import { FamiliarPane } from "./panes/FamiliarPane";
import { PlaybackPane } from "./panes/PlaybackPane";
import { AppearancePane } from "./panes/AppearancePane";
import { RetroArchPane } from "./panes/RetroArchPane";

// ── Section identifiers ───────────────────────────────────────────────────────

type SectionId =
  | "folders"
  | "cores"
  | "controllers"
  | "providers"
  | "familiar"
  | "playback"
  | "appearance"
  | "retroarch";

interface Section {
  id: SectionId;
  label: string;
}

const SECTIONS: Section[] = [
  { id: "folders", label: "Folders" },
  { id: "cores", label: "Cores" },
  { id: "controllers", label: "Controllers" },
  { id: "providers", label: "Providers" },
  { id: "familiar", label: "Familiar" },
  { id: "playback", label: "Playback" },
  { id: "appearance", label: "Appearance" },
  { id: "retroarch", label: "RetroArch" },
];

/** Render the active section pane. */
function SectionPane({ id }: { id: SectionId }) {
  switch (id) {
    case "folders":
      return <FoldersPane />;
    case "cores":
      return <CoresPane />;
    case "controllers":
      return <ControllersPane />;
    case "providers":
      return <ProvidersPane />;
    case "familiar":
      return <FamiliarPane />;
    case "playback":
      return <PlaybackPane />;
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
      className="harmony-panel"
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
        {/* Section nav — left column */}
        <nav
          aria-label="Settings sections"
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
              tabIndex={0}
              aria-current={active === s.id ? "page" : undefined}
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
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
          <SectionPane id={active} />
        </div>
      </div>
    </section>
  );
}
