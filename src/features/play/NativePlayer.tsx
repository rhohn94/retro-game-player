// NativePlayer — runs a game via Harmony's native libretro core host
// (v0.21 "Bedrock") instead of EmulatorJS. The Rust backend owns the entire
// emulation loop and the audio device (play::native::NativeRuntime); this
// component starts/stops that session, paints whatever frame it last
// produced onto a <canvas> via `putImageData`, and pushes keyboard/gamepad
// state into the core's input (W216 — see nativeInput.ts).
//
// v0.23 W232: the shared in-game overlay (PlayerOverlay) works here too —
// Escape or ☰ opens Resume / Save state / Load state / Exit; opening pauses
// the core (set_native_paused) and releases input so nothing sticks. The
// runtime switch that decides whether to mount this or InPagePlayer is
// PlaySwitch.tsx (W215).

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getNativeFrame,
  loadNativeState,
  saveNativeState,
  setNativeInput,
  setNativePaused,
  startNativePlay,
  stopNativePlay,
} from "../../ipc/native-play";
import { listGameSaves } from "../../ipc/native-play";
import type { SaveSlot } from "../../ipc/native-play";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { decodeRgba, isWellFormedRgba } from "./nativeFrame";
import { computeJoypadBits, isBoundKey } from "./nativeInput";
import { PlayerOverlay } from "./PlayerOverlay";
import { continueSlot } from "./saveSlots";
import { useOverlayMenu } from "./useOverlayMenu";

export interface NativePlayerProps {
  gameId: number;
  gameName: string;
  /** Called once if the native session fails to start — the caller (the
   * runtime-switch component, W215) decides what to do (typically: fall
   * back to InPagePlayer rather than show an error state). */
  onStartFailed?: () => void;
}

/** Mounts a native libretro core session for one game; auto-starts on load. */
export function NativePlayer({ gameId, gameName, onStartFailed }: NativePlayerProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [selection, setSelection] = useState(0);

  // Live mirror so the input handlers (installed once per session) read
  // current overlay state without re-subscribing.
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;

  const openOverlay = useCallback(() => {
    setSelection(0);
    setOverlayOpen(true);
    void setNativeInput(0).catch(() => undefined); // release held buttons
    void setNativePaused(true).catch(() => undefined);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    void setNativePaused(false).catch(() => undefined);
  }, []);

  const exitGame = useCallback(() => navigate(-1), [navigate]);

  // "Continue" (W232): if a state this path wrote exists (the exit auto-save
  // or a manual slot), offer to restore the newest one into the running,
  // freshly-booted session. Dismisses itself once used.
  const [continueTarget, setContinueTarget] = useState<SaveSlot | null>(null);
  useCancellableEffect(
    (isCancelled) => {
      listGameSaves(gameId)
        .then((saves) => {
          if (isCancelled()) return;
          setContinueTarget((continueSlot(saves, "native")?.slot as SaveSlot | undefined) ?? null);
        })
        .catch(() => undefined);
    },
    [gameId],
  );
  const onContinue = useCallback(() => {
    const slot = continueTarget;
    if (!slot) return;
    loadNativeState(slot)
      .then(() => setContinueTarget(null))
      .catch(() => undefined);
  }, [continueTarget]);

  const { items, status, resetView } = useOverlayMenu({
    gameId,
    activePath: "native",
    open: overlayOpen,
    resume: { key: "resume", label: "Resume", run: () => closeOverlay() },
    extras: [],
    exit: { key: "exit", label: "Exit game", run: () => exitGame() },
    saveSlot: (slot) => saveNativeState(slot),
    loadSlot: (slot) => loadNativeState(slot),
    onLoaded: () => closeOverlay(),
    onViewChange: () => setSelection(0),
  });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    if (overlayOpen) resetView();
  }, [overlayOpen, resetView]); // resetView is a stable callback

  useEffect(() => {
    let cancelled = false;
    let frameHandle = 0;
    const heldKeys = new Set<string>();
    let lastSentBits = -1; // -1 never matches a real bitmask, so the first tick always sends

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (overlayOpenRef.current) closeOverlay();
        else openOverlay();
        return;
      }
      if (overlayOpenRef.current) {
        // The overlay owns the keyboard: arrows move the selection, Enter
        // activates. Game keys are not captured while paused.
        const n = itemsRef.current.length;
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelection((s) => (s - 1 + n) % n);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelection((s) => (s + 1) % n);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const item = itemsRef.current[selectionRef.current];
          if (item && !item.disabled) item.run();
        }
        return;
      }
      if (!isBoundKey(e.code)) return;
      e.preventDefault(); // arrows/Tab/Enter would otherwise scroll or shift page focus
      heldKeys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (overlayOpenRef.current) return;
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
      if (overlayOpenRef.current) return; // paused — nothing reaches the core
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
  }, [gameId]); // intentionally re-subscribes per gameId only — open/close callbacks are stable

  return (
    <div className="harmony-player">
      <div className="harmony-player__frame">
        <canvas ref={canvasRef} className="harmony-native-player__canvas" aria-label={`Play ${gameName}`} />
      </div>
      <div className="harmony-player__bar">
        {continueTarget && (
          <button type="button" className="harmony-player__fs" onClick={onContinue}>
            ⟳ Continue
          </button>
        )}
        <button type="button" className="harmony-player__fs" onClick={openOverlay}>
          ☰ Menu
        </button>
        <button type="button" className="harmony-player__fs" onClick={exitGame}>
          ✕ Exit
        </button>
      </div>

      <PlayerOverlay
        gameName={gameName}
        open={overlayOpen}
        items={items}
        selection={selection}
        setSelection={setSelection}
        onScrimClick={closeOverlay}
        status={status}
        hint="Esc or ☰ to toggle"
      />
    </div>
  );
}
