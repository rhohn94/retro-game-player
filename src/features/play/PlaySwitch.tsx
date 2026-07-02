// PlaySwitch — chooses between the native libretro player (v0.21 "Bedrock",
// flagged off by default, NES only) and the existing in-page EmulatorJS
// player, falling back automatically — never a blank/broken screen — if
// native hosting fails to start for any reason. W215 — see
// docs/design/native-emulation-design.md §4.
//
// v0.23 W234: fallbacks are honest — when a path degrades (native start
// failure, play server unavailable) a dismissible notice above the player
// says what failed, what runs instead, and where to fix it
// (in-page-play-design.md §6). One notice per session per cause.

import { useCallback, useState } from "react";
import { InPagePlayer } from "./InPagePlayer";
import { NativePlayer } from "./NativePlayer";
import { PlayNotice } from "./PlayNotice";
import { inPageSystem } from "./ejs";
import { describeDegradation, recordDegradation } from "./degradation";
import type { DegradationNotice } from "./degradation";
import { getNativePlayEnabled } from "../../ipc/native-play";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";

/** Must match the Rust `play::native::NATIVE_SYSTEM` — the only system v0.21
 * "Bedrock" hosts natively. */
const NATIVE_SYSTEM = "nes";

export interface PlaySwitchProps {
  gameId: number;
  system: string;
  gameName: string;
}

/**
 * Picks the player for one game's detail screen. Renders nothing for a
 * system with no in-page path at all (native external RetroArch launch only
 * — unaffected by this switch).
 */
export function PlaySwitch({ gameId, system, gameName }: PlaySwitchProps) {
  const isNativeCandidate = system === NATIVE_SYSTEM;
  // null = still resolving the flag; true/false once known. Only matters for
  // the native-candidate system — every other system ignores it entirely.
  const [nativeEnabled, setNativeEnabled] = useState<boolean | null>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  // A degradation to surface above the (fallback) player — honest, never
  // blocking (W234). Only the first occurrence per session per cause shows.
  const [notice, setNotice] = useState<DegradationNotice | null>(null);

  const onNativeFailed = useCallback(() => {
    setNativeFailed(true);
    if (recordDegradation("native-start-failed")) {
      setNotice(describeDegradation("native-start-failed"));
    }
  }, []);

  const onEjsUnavailable = useCallback(() => {
    if (recordDegradation("play-server-unavailable")) {
      setNotice(describeDegradation("play-server-unavailable"));
    }
  }, []);

  useCancellableEffect(
    (isCancelled) => {
      if (!isNativeCandidate) return;
      getNativePlayEnabled()
        .then((enabled) => !isCancelled() && setNativeEnabled(enabled))
        .catch(() => !isCancelled() && setNativeEnabled(false));
    },
    [isNativeCandidate],
  );

  // Resolving the flag for a system that *could* go native — wait rather
  // than flash EmulatorJS only to immediately swap to the native player.
  if (isNativeCandidate && nativeEnabled === null) return null;

  const noticeEl = notice ? <PlayNotice notice={notice} /> : null;

  if (isNativeCandidate && nativeEnabled && !nativeFailed) {
    return (
      <>
        {noticeEl}
        <NativePlayer gameId={gameId} gameName={gameName} onStartFailed={onNativeFailed} />
      </>
    );
  }

  const ejsSystem = inPageSystem(system);
  if (!ejsSystem) return noticeEl;
  return (
    <>
      {noticeEl}
      <InPagePlayer
        gameId={gameId}
        ejsSystem={ejsSystem}
        gameName={gameName}
        onUnavailable={onEjsUnavailable}
      />
    </>
  );
}
