// PlaybackPane — the Settings "Playback" section (v0.21 "Bedrock", W215;
// pause-on-blur preference added by v0.24 W243).

import { useState, useEffect } from "react";
import { AuraButton } from "@aura/react";

import { getNativePlayEnabled, setNativePlayEnabled } from "../../../ipc/native-play";
import { getPlayerPrefs, setPlayerPrefs } from "../../../ipc/player-prefs";
import type { PlayerPrefs } from "../../../ipc/player-prefs";

export function PlaybackPane() {
  const [nativeEnabled, setNativeEnabledState] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<PlayerPrefs | null>(null);

  useEffect(() => {
    getNativePlayEnabled()
      .then(setNativeEnabledState)
      .catch((e: unknown) => setError(String(e)));
    getPlayerPrefs()
      .then(setPrefsState)
      .catch(() => setPrefsState(null));
  }, []);

  async function handleBlurToggle() {
    if (!prefs) return;
    const next = { ...prefs, pauseOnBlur: !prefs.pauseOnBlur };
    setPrefsState(next);
    try {
      await setPlayerPrefs(next);
    } catch (e: unknown) {
      setError(String(e));
      setPrefsState(prefs); // revert on failure
    }
  }

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
        cold-start crackle. On by default; if it fails to start for any
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

      <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Pause the game whenever Retro Game Player loses focus, resuming when you
        come back. Applies to both play paths.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AuraButton
          tabIndex={0}
          variant={prefs?.pauseOnBlur ? "secondary" : "ghost"}
          disabled={prefs === null}
          onClick={() => { void handleBlurToggle(); }}
        >
          {prefs?.pauseOnBlur ? "Pause on blur: on" : "Pause on blur: off"}
        </AuraButton>
      </div>
    </div>
  );
}
