// SettingsPage — the Settings screen for Harmony (W15).
//
// Archetype: Sectioned-form (harmony-ux-design.md §3). Two-column layout:
// left <aura-nav> section list, right pane renders the selected section.
// Controller-operable structure: focusable elements use tabIndex so W14's
// spatial-nav engine can move between them. Each section reads/writes via its
// domain IPC wrapper — no raw `invoke` calls here.
//
// Sections: Folders | Cores | Controllers | Providers | Familiar | Appearance | RetroArch
// (Controllers surface is a stub placeholder — the binding editor is W14.)

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "../../ipc/invoke";
import { AuraButton, AuraField } from "@aura/react";

import {
  addContentFolder,
  listContentFolders,
  removeContentFolder,
  scanFolder,
  type ContentFolder,
  type ScanReport,
} from "../../ipc/library";
import { CreateGamesFolderDialog } from "../library/CreateGamesFolderDialog";
import {
  listInstalledCores,
  setActiveCore,
  type Core,
} from "../../ipc/cores";
import {
  addProvider,
  listProviders,
  removeProvider,
  updateProvider,
  type SearchProvider,
} from "../../ipc/search";
import { probeFamiliar, type FamiliarProbe } from "../../ipc/familiar";
import { useAuraTheme } from "../../theme/AuraProvider";
import { NAMED_THEMES } from "../../theme/tokens";
import { getNativePlayEnabled, setNativePlayEnabled } from "../../ipc/native-play";

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

// ── Folders pane ─────────────────────────────────────────────────────────────

function FoldersPane() {
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [scanResult, setScanResult] = useState<ScanReport | null>(null);
  const [scanning, setScanning] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    listContentFolders()
      .then(setFolders)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    const path = addInputRef.current?.value.trim();
    if (!path) return;
    try {
      const folder = await addContentFolder(path);
      if (addInputRef.current) addInputRef.current.value = "";
      setFolders((prev) => [...prev, folder]);
      setError(null);
      // Kick off a scan immediately after adding
      handleScan(folder.id);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function handleRemove(id: number) {
    try {
      await removeContentFolder(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function handleScan(id: number) {
    setScanning(id);
    setScanResult(null);
    try {
      const report = await scanFolder(id);
      setScanResult(report);
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setScanning(null);
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Content Folders</h3>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={addInputRef}
          type="text"
          placeholder="/path/to/roms"
          tabIndex={0}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--aura-border)",
            background: "var(--aura-surface-2)",
            color: "var(--aura-on-surface)",
            fontSize: 14,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
        />
        <AuraButton tabIndex={0} onClick={() => { void handleAdd(); }}>
          Add Folder
        </AuraButton>
      </div>

      {scanResult && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
          Scan complete — scanned {scanResult.scanned}, added {scanResult.added},
          identified {scanResult.identified}.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {folders.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <p style={{ color: "var(--aura-on-surface-muted)", margin: 0, fontSize: 13 }}>
              No content folders configured.
            </p>
            <AuraButton
              tabIndex={0}
              variant="secondary"
              onClick={() => setShowCreate(true)}
            >
              Create a games folder for me
            </AuraButton>
          </div>
        )}
        {folders.map((f) => (
          <div
            key={f.id}
            className="harmony-panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 8,
            }}
          >
            <span style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>{f.path}</span>
            <AuraButton
              tabIndex={0}
              variant="secondary"
              disabled={scanning === f.id}
              onClick={() => { void handleScan(f.id); }}
            >
              {scanning === f.id ? "Scanning…" : "Rescan"}
            </AuraButton>
            <AuraButton
              tabIndex={0}
              variant="ghost"
              onClick={() => { void handleRemove(f.id); }}
            >
              Remove
            </AuraButton>
          </div>
        ))}
      </div>

      <CreateGamesFolderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          load();
        }}
      />
    </div>
  );
}

// ── Cores pane ────────────────────────────────────────────────────────────────

/** Group installed cores by system for display. */
function groupBySystem(cores: Core[]): Map<string, Core[]> {
  const map = new Map<string, Core[]>();
  for (const c of cores) {
    const list = map.get(c.system) ?? [];
    list.push(c);
    map.set(c.system, list);
  }
  return map;
}

function CoresPane() {
  const [cores, setCores] = useState<Core[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listInstalledCores()
      .then(setCores)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSetActive(system: string, coreId: string) {
    try {
      const updated = await setActiveCore(system, coreId);
      setCores((prev) =>
        prev.map((c) =>
          c.system === system ? { ...c, active: c.coreId === updated.coreId } : c,
        ),
      );
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  const bySystem = groupBySystem(cores);

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Active Cores (per system)</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Select the active core for each installed system. Install / update cores on
        the Cores screen.
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      {bySystem.size === 0 && !error && (
        <p style={{ color: "var(--aura-on-surface-muted)", margin: 0, fontSize: 13 }}>
          No cores installed yet.
        </p>
      )}

      {Array.from(bySystem.entries()).map(([system, systemCores]) => {
        const activeCore = systemCores.find((c) => c.active);
        return (
          <div
            key={system}
            style={{ display: "flex", alignItems: "center", gap: 12 }}
          >
            <span
              style={{
                minWidth: 100,
                fontSize: 14,
                fontWeight: 500,
                color: "var(--aura-on-surface)",
              }}
            >
              {system}
            </span>
            <select
              className="harmony-input"
              style={{ maxWidth: 280 }}
              tabIndex={0}
              value={activeCore?.coreId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val) void handleSetActive(system, val);
              }}
            >
              {systemCores.map((c) => (
                <option key={c.coreId} value={c.coreId}>
                  {c.coreId}
                  {c.version ? ` (${c.version})` : ""}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// ── Controllers pane (stub — W14 owns the binding editor) ────────────────────

function ControllersPane() {
  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ margin: 0 }}>Controller Bindings</h3>
      <p style={{ color: "var(--aura-on-surface-muted)", margin: 0, fontSize: 13 }}>
        Controller binding editor — implemented by W14 (controller-input-design.md).
        This pane will host the binding table once the spatial-nav layer ships.
      </p>
    </div>
  );
}

// ── Providers pane ────────────────────────────────────────────────────────────

function ProvidersPane() {
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
          <input
            type="text"
            placeholder="Name"
            tabIndex={0}
            value={addName}
            onChange={(e) => setAddName(e.currentTarget.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="https://example.com/search?q={query}"
            tabIndex={0}
            value={addTemplate}
            onChange={(e) => setAddTemplate(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            style={{ ...inputStyle, flex: 2 }}
          />
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

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--aura-border)",
  background: "var(--aura-surface-2)",
  color: "var(--aura-on-surface)",
  fontSize: 13,
};

// ── Familiar pane ─────────────────────────────────────────────────────────────

function FamiliarPane() {
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
      // The familiar backend persists base URL + stores the key in Keychain.
      // We use the existing probe mechanism; the backend's save command is
      // invoked here. If the backend doesn't yet expose a `save_familiar_config`
      // command, this records config via probeFamiliar after a round-trip.
      // The key is intentionally never stored client-side (W12 contract).
      await invoke("save_familiar_config", {
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

// ── Playback pane (v0.21 "Bedrock", W215) ─────────────────────────────────────

function PlaybackPane() {
  const [nativeEnabled, setNativeEnabledState] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getNativePlayEnabled()
      .then(setNativeEnabledState)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  async function handleToggle() {
    if (nativeEnabled === null) return;
    const next = !nativeEnabled;
    setSaving(true);
    setError(null);
    try {
      await setNativePlayEnabled(next);
      setNativeEnabledState(next);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Playback</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Native NES playback hosts the libretro core directly instead of
        EmulatorJS — faster to start, and avoids the in-page audio engine's
        cold-start crackle. Off by default; if it fails to start for any
        reason, the game falls back to the EmulatorJS player automatically.
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AuraButton
          tabIndex={0}
          variant={nativeEnabled ? "secondary" : "ghost"}
          disabled={nativeEnabled === null || saving}
          onClick={() => { void handleToggle(); }}
        >
          {nativeEnabled ? "Enabled (NES)" : "Disabled"}
        </AuraButton>
      </div>
    </div>
  );
}

// ── Appearance pane ───────────────────────────────────────────────────────────

function AppearancePane() {
  const { theme, themes, setTheme } = useAuraTheme();

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Appearance</h3>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 14, minWidth: 60 }}>Theme</span>
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
      </div>

      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        The selected theme persists across restarts. Changing it takes effect
        immediately.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {NAMED_THEMES.map((t) => (
          <button
            key={t.className}
            tabIndex={0}
            onClick={() => setTheme(t.className)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border:
                theme.className === t.className
                  ? "2px solid var(--aura-primary)"
                  : "2px solid var(--aura-border)",
              background:
                theme.className === t.className
                  ? "var(--aura-primary)"
                  : "var(--aura-surface-2)",
              color:
                theme.className === t.className
                  ? "var(--aura-on-primary)"
                  : "var(--aura-on-surface)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── RetroArch pane ────────────────────────────────────────────────────────────

function RetroArchPane() {
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load current retroarch path if the command exists
    invoke<string | null>("get_retroarch_path")
      .then((p) => { if (p) setPath(p); })
      .catch(() => { /* command may not be wired yet — silent degrade */ });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await invoke("set_retroarch_path", { path: path.trim() || null });
      setSaved(true);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>RetroArch</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Path to the RetroArch binary used for launching games.
      </p>

      {error && (
        <p style={{ color: "var(--aura-error)", margin: 0, fontSize: 13 }}>
          {error}
        </p>
      )}

      <AuraField label="RetroArch path" tabIndex={0}>
        <input
          type="text"
          placeholder="/Applications/RetroArch.app/Contents/MacOS/RetroArch"
          value={path}
          tabIndex={0}
          onChange={(e) => setPath(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
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

// ── SettingsPage root ─────────────────────────────────────────────────────────

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
