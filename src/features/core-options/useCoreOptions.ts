// useCoreOptions — data-fetching hook for the Core Options screen (v0.29
// W282). Mirrors `features/cores/useCores.ts`'s shape: loads the active
// native-hosted core's declared options (folded with persisted/default
// values) over IPC, and exposes a per-option save mutation. All FFI/DB work
// runs off the UI thread in the Rust adapter; this hook only coordinates
// React state.

import { useCallback, useEffect, useRef, useState } from "react";
import { isAppError } from "../../ipc/error";
import { listCoreOptions, setCoreOption, type CoreOption } from "../../ipc/core-options";

/** Per-option in-flight save state. */
export type OptionSaveState = "saving" | null;

export interface UseCoreOptionsResult {
  /** The active core's declared options, each with its effective value. */
  options: CoreOption[];
  /** True while the initial list fetch is in flight. */
  loading: boolean;
  /** Top-level fetch error — `null` when absent. A human-readable message,
   * or `"unsupported"` verbatim when `system` has no native-hosted core
   * (the caller uses this to withhold the whole screen). */
  fetchError: string | null;
  /** True when the fetch error specifically means "no native core options
   * entry point for this system" — distinct from a transient failure. */
  unsupported: boolean;
  /** Per-option save state, keyed by option key. */
  saveState: (key: string) => OptionSaveState;
  /** Per-option save error, keyed by option key. */
  saveError: (key: string) => string | null;
  /** Persist a new value for one option; updates local state on success. */
  setValue: (key: string, value: string) => Promise<void>;
}

/** Extract a human-readable message from an unknown IPC error. */
function errorMessage(err: unknown): string {
  if (isAppError(err)) {
    if (err.kind === "unsupported") return "unsupported";
    if (err.kind === "not_found") return "The active core is not installed.";
    if (err.kind === "dependency") return "The core could not be loaded.";
    return err.detail || "Unknown error.";
  }
  return String(err);
}

/**
 * Fetches the active native-hosted core's declared options for `system` and
 * provides a per-option save mutation. Pass the system id (e.g. `"nes"`);
 * callers gate mounting on `nativePath.NATIVE_SYSTEM` themselves (this hook
 * still resolves cleanly to `unsupported` for a non-native system, matching
 * the backend's own gate).
 */
export function useCoreOptions(system: string): UseCoreOptionsResult {
  const [options, setOptions] = useState<CoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveStateMap, setSaveStateMap] = useState<Record<string, OptionSaveState>>({});
  const [saveErrorMap, setSaveErrorMap] = useState<Record<string, string | null>>({});

  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);
    setFetchError(null);

    listCoreOptions(system)
      .then((list) => {
        if (cancelled.current) return;
        setOptions(list);
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
  }, [system]);

  const setValue = useCallback(
    async (key: string, value: string): Promise<void> => {
      setSaveStateMap((prev) => ({ ...prev, [key]: "saving" }));
      setSaveErrorMap((prev) => ({ ...prev, [key]: null }));
      try {
        await setCoreOption(system, key, value);
        setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, value } : o)));
      } catch (err) {
        setSaveErrorMap((prev) => ({ ...prev, [key]: errorMessage(err) }));
      } finally {
        setSaveStateMap((prev) => ({ ...prev, [key]: null }));
      }
    },
    [system],
  );

  const saveState = useCallback(
    (key: string): OptionSaveState => saveStateMap[key] ?? null,
    [saveStateMap],
  );

  const saveError = useCallback(
    (key: string): string | null => saveErrorMap[key] ?? null,
    [saveErrorMap],
  );

  return {
    options,
    loading,
    fetchError,
    unsupported: fetchError === "unsupported",
    saveState,
    saveError,
    setValue,
  };
}
