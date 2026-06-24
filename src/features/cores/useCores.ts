// useCores — data-fetching hook for the Cores Management screen (W16).
// Loads available cores (per-system catalog folded with install state) from the
// W5 backend over IPC and exposes mutation callbacks for install, update, and
// set-active. All network/IO runs off the UI thread in the Rust adapter; this
// hook only coordinates React state.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  installCore,
  isAppError,
  listAvailableCores,
  setActiveCore,
  updateCore,
  type Core,
} from "../../ipc/commands";

/** Grouped cores keyed by system id. */
export type CoresBySystem = Record<string, Core[]>;

/** Per-core in-flight action state. */
export type CoreAction = "installing" | "updating" | "activating" | null;

/** Error detail: which core failed and why. */
export interface CoreError {
  coreId: string;
  system: string;
  message: string;
}

export interface UseCoresResult {
  /** Cores grouped by system, sorted default-first. */
  coresBySystem: CoresBySystem;
  /** Ordered list of system ids (nes, snes, n64). */
  systems: string[];
  /** True while the initial list fetch is in flight. */
  loading: boolean;
  /** Top-level fetch error (null when absent). */
  fetchError: string | null;
  /** Per-core action state: "installing" | "updating" | "activating" | null. */
  actionState: (system: string, coreId: string) => CoreAction;
  /** Per-core error (cleared on next action for that core). */
  actionError: (system: string, coreId: string) => CoreError | null;
  /** Install a curated core; updates state in place on success. */
  install: (system: string, coreId: string) => Promise<void>;
  /** Update an installed core to the latest buildbot version. */
  update: (core: Core) => Promise<void>;
  /** Mark an installed core active for its system. */
  activate: (system: string, coreId: string) => Promise<void>;
}

/** Stable key for action/error maps. */
function key(system: string, coreId: string): string {
  return `${system}:${coreId}`;
}

/** Extract a human-readable message from an unknown IPC error. */
function errorMessage(err: unknown): string {
  if (isAppError(err)) {
    const e = err as { kind: string; detail?: string };
    if (e.kind === "unsupported") return "Not supported on this architecture.";
    if (e.kind === "network") return "Network error — check your connection.";
    if (e.kind === "io") return "Disk error while writing core.";
    if (e.kind === "not_found") return "Core not found — try reinstalling.";
    if (e.kind === "conflict") return "A conflict occurred; try again.";
    return e.detail ?? "Unknown error.";
  }
  return String(err);
}

/** Place or replace a core in the grouped map, preserving order. */
function upsertCore(prev: CoresBySystem, updated: Core): CoresBySystem {
  const group = prev[updated.system] ?? [];
  const idx = group.findIndex((c) => c.coreId === updated.coreId);
  const next = idx >= 0
    ? group.map((c) => (c.coreId === updated.coreId ? updated : c))
    : [...group, updated];
  return { ...prev, [updated.system]: next };
}

/** Systems in display order (matches design doc). */
const SYSTEM_ORDER = ["nes", "snes", "n64"];

/**
 * Fetches all curated cores and provides install/update/activate mutations.
 * Automatically re-sorts the system list on load.
 */
export function useCores(): UseCoresResult {
  const [coresBySystem, setCoresBySystem] = useState<CoresBySystem>({});
  const [systems, setSystems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Per-core action and error states stored in refs to avoid re-renders on every
  // keystroke while still available synchronously in callbacks.
  const [actionMap, setActionMap] = useState<Record<string, CoreAction>>({});
  const [errorMap, setErrorMap] = useState<Record<string, CoreError | null>>({});

  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);
    setFetchError(null);

    listAvailableCores()
      .then((cores) => {
        if (cancelled.current) return;
        const grouped: CoresBySystem = {};
        for (const core of cores) {
          (grouped[core.system] ??= []).push(core);
        }
        const orderedSystems = [
          ...SYSTEM_ORDER.filter((s) => s in grouped),
          ...Object.keys(grouped).filter((s) => !SYSTEM_ORDER.includes(s)),
        ];
        setCoresBySystem(grouped);
        setSystems(orderedSystems);
      })
      .catch((err: unknown) => {
        if (cancelled.current) return;
        setFetchError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled.current) setLoading(false);
      });

    return () => {
      cancelled.current = true;
    };
  }, []);

  const setAction = useCallback(
    (system: string, coreId: string, action: CoreAction) => {
      setActionMap((prev) => ({ ...prev, [key(system, coreId)]: action }));
    },
    [],
  );

  const setError = useCallback(
    (system: string, coreId: string, error: CoreError | null) => {
      setErrorMap((prev) => ({ ...prev, [key(system, coreId)]: error }));
    },
    [],
  );

  const install = useCallback(
    async (system: string, coreId: string): Promise<void> => {
      setAction(system, coreId, "installing");
      setError(system, coreId, null);
      try {
        const updated = await installCore(system, coreId);
        setCoresBySystem((prev) => upsertCore(prev, updated));
      } catch (err) {
        setError(system, coreId, {
          coreId,
          system,
          message: errorMessage(err),
        });
      } finally {
        setAction(system, coreId, null);
      }
    },
    [setAction, setError],
  );

  const update = useCallback(
    async (core: Core): Promise<void> => {
      setAction(core.system, core.coreId, "updating");
      setError(core.system, core.coreId, null);
      try {
        const updated = await updateCore(core.id);
        setCoresBySystem((prev) => upsertCore(prev, updated));
      } catch (err) {
        setError(core.system, core.coreId, {
          coreId: core.coreId,
          system: core.system,
          message: errorMessage(err),
        });
      } finally {
        setAction(core.system, core.coreId, null);
      }
    },
    [setAction, setError],
  );

  const activate = useCallback(
    async (system: string, coreId: string): Promise<void> => {
      setAction(system, coreId, "activating");
      setError(system, coreId, null);
      try {
        const updated = await setActiveCore(system, coreId);
        // Flip the active flag: exactly one active per system.
        setCoresBySystem((prev) => {
          const group = (prev[system] ?? []).map((c) => ({
            ...c,
            active: c.coreId === updated.coreId,
          }));
          return { ...prev, [system]: group };
        });
      } catch (err) {
        setError(system, coreId, {
          coreId,
          system,
          message: errorMessage(err),
        });
      } finally {
        setAction(system, coreId, null);
      }
    },
    [setAction, setError],
  );

  const actionState = useCallback(
    (system: string, coreId: string): CoreAction =>
      actionMap[key(system, coreId)] ?? null,
    [actionMap],
  );

  const actionError = useCallback(
    (system: string, coreId: string): CoreError | null =>
      errorMap[key(system, coreId)] ?? null,
    [errorMap],
  );

  return {
    coresBySystem,
    systems,
    loading,
    fetchError,
    actionState,
    actionError,
    install,
    update,
    activate,
  };
}
