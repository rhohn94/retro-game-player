// NativePlayer — runs a game via Harmony's native libretro core host
// (v0.21 "Bedrock") instead of EmulatorJS. The Rust backend owns the entire
// emulation loop and the audio device (play::native::NativeRuntime); this
// component starts/stops that session, paints whatever frame it last
// produced onto a <canvas> via `putImageData`, and pushes keyboard/gamepad
// state into the core's input (W216 — see nativeInput.ts).
//
// Scope is deliberately narrow: no overlay, no fullscreen chrome. The
// runtime switch that decides whether to mount this or InPagePlayer is
// PlaySwitch.tsx (W215).

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getNativeFrame, setNativeInput, startNativePlay, stopNativePlay } from "../../ipc/native-play";
import { decodeRgba, isWellFormedRgba } from "./nativeFrame";
import { computeJoypadBits, isBoundKey } from "./nativeInput";

export interface NativePlayerProps {
  gameId: number;
  gameName: string;
  /** Called once if the native session fails to start — the caller (the
   * future runtime-switch component, W215) decides what to do (typically:
   * fall back to InPagePlayer rather than show an error state). */
  onStartFailed?: () => void;
}

/** Mounts a native libretro core session for one game; auto-starts on load. */
export function NativePlayer({ gameId, gameName, onStartFailed }: NativePlayerProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let frameHandle = 0;
    const heldKeys = new Set<string>();
    let lastSentBits = -1; // -1 never matches a real bitmask, so the first tick always sends

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isBoundKey(e.code)) return;
      e.preventDefault(); // arrows/Tab/Enter would otherwise scroll or shift page focus
      heldKeys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isBoundKey(e.code)) return;
      e.preventDefault();
      heldKeys.delete(e.code);
    };
    // Losing window focus (e.g. alt-tab) with a key physically held would
    // otherwise leave it "stuck" pressed forever, since no keyup ever fires.
    const onBlur = () => heldKeys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    const pollInput = () => {
      const gamepad = navigator.getGamepads?.()[0] ?? null;
      const bits = computeJoypadBits(heldKeys, gamepad);
      if (bits !== lastSentBits) {
        lastSentBits = bits;
        void setNativeInput(bits).catch(() => {
          /* a missed input tick isn't fatal — the next poll retries */
        });
      }
    };

    const paintNextFrame = () => {
      if (cancelled) return;
      pollInput();
      getNativeFrame()
        .then((frame) => {
          const canvas = canvasRef.current;
          if (!frame || !canvas) return;
          const bytes = decodeRgba(frame.rgbaBase64);
          if (!isWellFormedRgba(frame, bytes)) return; // a truncated/corrupt frame — skip, try again next tick
          if (canvas.width !== frame.width) canvas.width = frame.width;
          if (canvas.height !== frame.height) canvas.height = frame.height;
          canvas.getContext("2d")?.putImageData(new ImageData(bytes, frame.width, frame.height), 0, 0);
        })
        .catch(() => {
          /* a poll failing isn't fatal — try again next tick */
        })
        .finally(() => {
          if (!cancelled) frameHandle = requestAnimationFrame(paintNextFrame);
        });
    };

    startNativePlay(gameId)
      .then(() => {
        if (!cancelled) frameHandle = requestAnimationFrame(paintNextFrame);
      })
      .catch(() => {
        if (!cancelled) onStartFailed?.();
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      void setNativeInput(0).catch(() => undefined); // release all buttons before tearing down
      void stopNativePlay();
    };
  }, [gameId]); // intentionally re-subscribes per gameId only — onStartFailed is a stable callback in intended usage

  return (
    <div className="harmony-player">
      <div className="harmony-player__frame">
        <canvas ref={canvasRef} className="harmony-native-player__canvas" aria-label={`Play ${gameName}`} />
      </div>
      <div className="harmony-player__bar">
        <button type="button" className="harmony-player__fs" onClick={() => navigate(-1)}>
          ✕ Exit
        </button>
      </div>
    </div>
  );
}
