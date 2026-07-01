// CoresPane — the Settings "Cores" section (per-system active core selection).

import { useCallback, useEffect, useState } from "react";
import { AuraField } from "@aura/react";

import { listInstalledCores, setActiveCore, type Core } from "../../../ipc/cores";

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

export function CoresPane() {
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
            <AuraField tabIndex={0}>
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
            </AuraField>
          </div>
        );
      })}
    </div>
  );
}
