// usePlayerPrefs — loads the persisted player preferences (volume +
// pause-on-blur, v0.24 W243) and exposes a volume setter that applies
// immediately and persists debounced (a slider drag fires dozens of changes;
// one config write per settle is plenty). Pure helpers live alongside for
// unit testing.

import { useCallback, useEffect, useRef, useState } from "react";
import { getPlayerPrefs, setPlayerPrefs } from "../../ipc/player-prefs";
import { swallow } from "../../ipc/swallow";

/** How long after the last volume change the persist write fires. */
const PERSIST_DEBOUNCE_MS = 400;

/** Volume restored by unmute when the stored volume is 0 (fully muted). */
const UNMUTE_FALLBACK = 0.5;

/** Clamps a volume into [0, 1]; non-finite input becomes 1 (full volume). */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

/**
 * The volume a mute-toggle should switch to: 0 when audible, else the last
 * audible volume (or a sensible fallback when none is known).
 */
export function toggledMuteVolume(current: number, lastAudible: number): number {
  if (current > 0) return 0;
  return lastAudible > 0 ? lastAudible : UNMUTE_FALLBACK;
}

export interface PlayerPrefsState {
  /** Current volume [0, 1]; 1 until the load resolves. */
  volume: number;
  /** Pause-on-window-blur preference; true until the load resolves. */
  pauseOnBlur: boolean;
  /** Applies + persists a new volume (clamped). */
  setVolume: (volume: number) => void;
  /** Toggles mute (restoring the last audible volume). */
  toggleMute: () => void;
}

/** Loads the persisted prefs once and manages volume changes. */
export function usePlayerPrefs(onVolumeApplied?: (volume: number) => void): PlayerPrefsState {
  const [volume, setVolumeState] = useState(1);
  const [pauseOnBlur, setPauseOnBlur] = useState(true);
  const lastAudible = useRef(1);
  const persistTimer = useRef<number | null>(null);

  // Live mirrors so stable callbacks read current values.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const pauseOnBlurRef = useRef(pauseOnBlur);
  pauseOnBlurRef.current = pauseOnBlur;
  const applyRef = useRef(onVolumeApplied);
  applyRef.current = onVolumeApplied;

  useEffect(() => {
    let cancelled = false;
    getPlayerPrefs()
      .then((prefs) => {
        if (cancelled) return;
        const v = clampVolume(prefs.volume);
        setVolumeState(v);
        setPauseOnBlur(prefs.pauseOnBlur);
        if (v > 0) lastAudible.current = v;
        applyRef.current?.(v);
      })
      .catch((err: unknown) => swallow(err, "usePlayerPrefs.load")); // defaults (1, true) stand
    return () => {
      cancelled = true;
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    };
  }, []);

  const setVolume = useCallback((next: number) => {
    const v = clampVolume(next);
    setVolumeState(v);
    if (v > 0) lastAudible.current = v;
    applyRef.current?.(v);
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void setPlayerPrefs({ volume: v, pauseOnBlur: pauseOnBlurRef.current }).catch((err: unknown) =>
        swallow(err, "usePlayerPrefs.persistVolume"),
      );
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  const toggleMute = useCallback(() => {
    setVolume(toggledMuteVolume(volumeRef.current, lastAudible.current));
  }, [setVolume]);

  return { volume, pauseOnBlur, setVolume, toggleMute };
}
