// useCrtFilter — loads the persisted CRT filter config (v0.29 W280,
// crt-filter-design.md) and exposes setters that apply immediately and
// persist debounced, mirroring usePlayerPrefs's volume-slider pattern (a
// slider drag fires dozens of changes; one config write per settle is
// plenty). Shared by the settings panel (read/write) and both players
// (read-only consumption — NativePlayer's WebGL2 shader and InPagePlayer's
// CSS overlay both read the same live `config` from this hook).

import { useCallback, useEffect, useRef, useState } from "react";
import { getCrtFilter, setCrtFilter as persistCrtFilter } from "../../ipc/crt-filter";
import type { CrtFilterConfig, CrtPreset } from "../../ipc/crt-filter";
import { CRT_FILTER_OFF, applyCrtPreset, clampCrtFilter, matchingPreset } from "./crtFilter";
import { swallow } from "../../ipc/swallow";

/** How long after the last slider change the persist write fires. */
const PERSIST_DEBOUNCE_MS = 400;

export interface CrtFilterState {
  /** The live config — `CRT_FILTER_OFF` until the initial load resolves, so
   * every consumer has a safe, inert default to render with immediately. */
  config: CrtFilterConfig;
  /** True once the initial load has resolved (or failed) — consumers that
   * want to avoid a flash-of-off can gate a fade-in on this. */
  ready: boolean;
  /** Applies + persists one effect's new intensity (clamped, and reclassifies
   * `preset` by recomputing the match rather than trusting the caller). */
  setIntensity: (key: "scanlines" | "curvature" | "colorBleed" | "vignette", value: number) => void;
  /** Applies + persists a named preset immediately (no debounce — a single
   * discrete action, unlike a slider drag). */
  setPreset: (preset: CrtPreset) => void;
}

/** Loads the persisted CRT filter config once and manages live updates. */
export function useCrtFilter(): CrtFilterState {
  const [config, setConfigState] = useState<CrtFilterConfig>(CRT_FILTER_OFF);
  const [ready, setReady] = useState(false);
  const persistTimer = useRef<number | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    let cancelled = false;
    getCrtFilter()
      .then((cfg) => {
        if (cancelled) return;
        setConfigState(clampCrtFilter(cfg));
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setReady(true); // CRT_FILTER_OFF stands
        swallow(err, "useCrtFilter.load");
      });
    return () => {
      cancelled = true;
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    };
  }, []);

  const persistDebounced = useCallback((next: CrtFilterConfig) => {
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void persistCrtFilter(next).catch((err: unknown) => swallow(err, "useCrtFilter.persistDebounced"));
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  const setIntensity = useCallback(
    (key: "scanlines" | "curvature" | "colorBleed" | "vignette", value: number) => {
      const next = clampCrtFilter({ ...configRef.current, [key]: value });
      next.preset = matchingPreset(next);
      setConfigState(next);
      persistDebounced(next);
    },
    [persistDebounced],
  );

  const setPreset = useCallback(
    (preset: CrtPreset) => {
      const next = applyCrtPreset(preset);
      setConfigState(next);
      // Discrete action (a button press, not a drag) — persist right away.
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
      void persistCrtFilter(next).catch((err: unknown) => swallow(err, "useCrtFilter.setPreset"));
    },
    [],
  );

  return { config, ready, setIntensity, setPreset };
}
