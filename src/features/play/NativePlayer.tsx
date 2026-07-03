// NativePlayer — runs a game via the app's native libretro core host
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
//
// v0.27 W272: while mounted foreground (or in the TV takeover) this player
// owns the controller's exclusive slot via the shared scope
// (useExclusiveControllerScope) — previously it never claimed the slot, so
// the base spatial engine stayed live underneath (on the TV home, PS ✕ =
// `confirm` could activate the focused tile and launch a DIFFERENT game
// mid-play). `menu` summons the overlay and the controller drives it; game
// buttons keep flowing via the raw gamepad poll below, never via semantic
// actions.
//
// v0.27 W273: the "preview" presentation is the TV hover-attract spectator
// surface (tv-mode-design.md §v0.27 → W273). Like "background" it detaches
// ALL input (keyboard + gamepad poll — the page keeps the controller) and
// ducks audio to the attract gain; unlike it the SESSION itself is pure: no
// library-life play-session record (usePlaySession disabled via
// presentationRecordsPlaySession), the backend session starts save-less
// (`preview: true` → saves: None, no perf log), and the render is a bare
// canvas — no Continue button, no chip bar, no overlay affordances.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getNativeFrame,
  loadNativeState,
  saveNativeState,
  setNativeInput,
  setNativePaused,
  setNativeVolume,
  startNativePlay,
  stopNativePlay,
} from "../../ipc/native-play";
import { listGameSaves } from "../../ipc/native-play";
import type { SaveSlot } from "../../ipc/native-play";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { parseFrameBuffer } from "./nativeFrame";
import { computeJoypadBits, isBoundKey } from "./nativeInput";
import { PlayerOverlay } from "./PlayerOverlay";
import {
  playerShellClass,
  presentationIsSpectator,
  presentationRecordsPlaySession,
  type PlayerPresentation,
} from "./presentation";
import { usePlayerPrefs } from "./playerPrefs";
import { usePlaySession } from "./playSession";
import { continueSlot } from "./saveSlots";
import { useExclusiveControllerScope } from "./useExclusiveControllerScope";
import { useOverlayMenu } from "./useOverlayMenu";

/** Ducked audio gain while the game plays as the page background (W235). */
const ATTRACT_GAIN = 0.3;

export interface NativePlayerProps {
  gameId: number;
  gameName: string;
  /** How the player is presented (presentation.ts). "background" (W235
   * attract) re-presents the live canvas as a dimmed, full-bleed page
   * backdrop — input detaches, audio ducks, the session keeps running, and
   * the page keeps the controller. "takeover" (v0.27 W272) is the TV
   * fullscreen surface — edge-to-edge fill, controller owned like
   * foreground. "preview" (v0.27 W273) is the TV hover-attract spectator
   * surface — a no-trace session (no play record, no saves), input fully
   * detached, audio ducked, bare canvas only; a mount is preview for its
   * whole life (the TV home keys the mount to the dwelt game). Default
   * "foreground" (the interactive detail-page player). */
  presentation?: PlayerPresentation;
  /** Called once if the native session fails to start — the caller (the
   * runtime-switch component, W215) decides what to do (typically: fall
   * back to InPagePlayer rather than show an error state). */
  onStartFailed?: () => void;
  /** How "Exit game" leaves (v0.26 W265). Default (desktop detail route):
   * `navigate(-1)`. The TV takeover surface supplies its own callback so exit
   * collapses the takeover back to the tile instead of popping router history. */
  onExit?: () => void;
}

/** Mounts a native libretro core session for one game; auto-starts on load. */
export function NativePlayer({
  gameId,
  gameName,
  presentation = "foreground",
  onStartFailed,
  onExit,
}: NativePlayerProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [selection, setSelection] = useState(0);

  // W273: a preview session is a no-trace spectator session end-to-end —
  // `preview` gates the backend save wiring (below) and the play-session
  // record; `spectator` (background OR preview) gates input + the audio duck.
  const preview = presentation === "preview";
  const spectator = presentationIsSpectator(presentation);

  // Library-life play-session tracking (v0.26 W264): brackets the native
  // session's start/stop lifetime (the effect below re-subscribes per
  // `gameId`/`preview` only — matching this hook's own dependencies).
  // Disabled for previews (W273 purity: no play count / recency / play-time).
  usePlaySession(gameId, presentationRecordsPlaySession(presentation));

  // Live mirrors so the input handlers (installed once per session) read
  // current overlay/presentation state without re-subscribing.
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;
  const spectatorRef = useRef(spectator);
  spectatorRef.current = spectator;

  // Player prefs (W243): the persisted volume feeds the effective gain
  // below; pause-on-blur is read by the window blur/focus handlers.
  const prefs = usePlayerPrefs();
  const pauseOnBlurRef = useRef(true);
  pauseOnBlurRef.current = prefs.pauseOnBlur;

  // One place computes what the core should output: the user's volume,
  // ducked while the game plays as a spectator surface — the W235 page
  // background and the W273 TV preview share the same attract gain.
  // Re-applied whenever either input changes and after a session (re)starts.
  const effectiveGain = prefs.volume * (spectator ? ATTRACT_GAIN : 1);
  const effectiveGainRef = useRef(effectiveGain);
  effectiveGainRef.current = effectiveGain;
  useEffect(() => {
    void setNativeVolume(effectiveGain).catch(() => undefined);
  }, [effectiveGain]);

  // Spectator transitions (W235 attract; W273 preview from mount): release
  // every held button exactly once at the handoff (nothing sticks). The core
  // keeps running throughout — no reboot; the gain effect above handles the
  // duck/restore.
  useEffect(() => {
    if (spectator) {
      setOverlayOpen(false); // a spectator shows the running game, never a menu
      void setNativePaused(false).catch(() => undefined);
      void setNativeInput(0).catch(() => undefined);
    }
  }, [spectator]);

  const openOverlay = useCallback(() => {
    setSelection(0);
    setOverlayOpen(true);
    // Eagerly mirror into the ref BEFORE dispatching the input release: the
    // state commit lands a frame later, and this player's raw input poll can
    // tick in the SAME frame the controller dispatched `menu` — with a stale
    // ref it re-sent the held bits (Start shares its physical button with
    // `menu`), stomping the release-to-zero below and leaking a one-frame
    // Start press to the core (W275).
    overlayOpenRef.current = true;
    void setNativeInput(0).catch(() => undefined); // release held buttons
    void setNativePaused(true).catch(() => undefined);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    overlayOpenRef.current = false; // eager mirror — see openOverlay
    void setNativePaused(false).catch(() => undefined);
  }, []);

  // Keep the latest onExit reachable from the stable overlay-menu callback.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const exitGame = useCallback(() => {
    // TV takeover supplies its own exit (collapse to the tile); the desktop
    // detail route falls back to popping history back to the grid.
    if (onExitRef.current) onExitRef.current();
    else navigate(-1);
  }, [navigate]);

  // "Continue" (W232): if a state this path wrote exists (the exit auto-save
  // or a manual slot), offer to restore the newest one into the running,
  // freshly-booted session. Dismisses itself once used. A preview renders no
  // Continue affordance and must not touch saves at all (W273 purity), so it
  // skips even this read.
  const [continueTarget, setContinueTarget] = useState<SaveSlot | null>(null);
  useCancellableEffect(
    (isCancelled) => {
      if (preview) return;
      listGameSaves(gameId)
        .then((saves) => {
          if (isCancelled()) return;
          setContinueTarget((continueSlot(saves, "native")?.slot as SaveSlot | undefined) ?? null);
        })
        .catch(() => undefined);
    },
    [gameId, preview],
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
    extras: [
      {
        key: "mute",
        label: prefs.volume === 0 ? "🔇 Unmute" : "🔇 Mute",
        run: () => prefs.toggleMute(),
      },
    ],
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

  // Own the controller's exclusive slot while foreground/takeover (W272 — see
  // file header). `ready` is unconditionally true: the native session boots on
  // mount, and holding the slot for the whole foreground mount means nothing
  // leaks to the page beneath even during the boot frames. Backgrounded
  // (attract) sessions leave the slot free — the page owns the controller.
  useExclusiveControllerScope({
    presentation,
    ready: true,
    overlayOpen,
    items,
    selection,
    setSelection,
    openOverlay,
    closeOverlay,
  });

  useEffect(() => {
    let cancelled = false;
    let frameHandle = 0;
    const heldKeys = new Set<string>();
    let lastSentBits = -1; // -1 never matches a real bitmask, so the first tick always sends

    const onKeyDown = (e: KeyboardEvent) => {
      // Spectator (attract background / TV preview): the page owns the
      // keyboard entirely — no capture, no preventDefault (arrows/space must
      // scroll), no overlay.
      if (spectatorRef.current) return;
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
      if (spectatorRef.current || overlayOpenRef.current) return;
      if (!isBoundKey(e.code)) return;
      e.preventDefault();
      heldKeys.delete(e.code);
    };
    // Losing window focus (e.g. alt-tab) with a key physically held would
    // otherwise leave it "stuck" pressed forever, since no keyup ever fires.
    // Pause-on-blur (W243): also freeze the game, resuming on refocus —
    // unless the overlay already paused it (the overlay owns that pause).
    let blurPaused = false;
    const onBlur = () => {
      heldKeys.clear();
      if (pauseOnBlurRef.current && !overlayOpenRef.current) {
        blurPaused = true;
        void setNativePaused(true).catch(() => undefined);
      }
    };
    const onFocus = () => {
      if (!blurPaused) return;
      blurPaused = false;
      if (!overlayOpenRef.current) void setNativePaused(false).catch(() => undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    const pollInput = () => {
      // Paused behind the overlay or spectating — nothing reaches the core.
      if (overlayOpenRef.current || spectatorRef.current) return;
      const gamepad = navigator.getGamepads?.()[0] ?? null;
      const bits = computeJoypadBits(heldKeys, gamepad);
      if (bits !== lastSentBits) {
        lastSentBits = bits;
        void setNativeInput(bits).catch(() => {
          /* a missed input tick isn't fatal — the next poll retries */
        });
      }
    };

    // Raw-bytes frame polling (W239). The rAF tick is scheduled up-front so a
    // slow IPC round trip degrades to a skipped paint, never a halved frame
    // rate; the in-flight guard keeps at most one request crossing the
    // boundary. `lastSeq` echoes the backend's frame counter — an unchanged
    // frame answers with an empty body instead of a 245 KB payload.
    let lastSeq = 0;
    let inFlight = false;
    const paintNextFrame = () => {
      if (cancelled) return;
      frameHandle = requestAnimationFrame(paintNextFrame);
      pollInput();
      if (inFlight) return;
      inFlight = true;
      getNativeFrame(lastSeq)
        .then((buf) => {
          const frame = parseFrameBuffer(buf);
          const canvas = canvasRef.current;
          if (!frame || !canvas) return; // nothing new (or malformed) — paint again next tick
          lastSeq = frame.seq;
          if (canvas.width !== frame.width) canvas.width = frame.width;
          if (canvas.height !== frame.height) canvas.height = frame.height;
          canvas.getContext("2d")?.putImageData(new ImageData(frame.bytes, frame.width, frame.height), 0, 0);
        })
        .catch(() => {
          /* a poll failing isn't fatal — try again next tick */
        })
        .finally(() => {
          inFlight = false;
        });
    };

    // W273: a preview session starts with NO save wiring and NO perf log
    // backend-side — booting it can never disturb a real session's traces.
    startNativePlay(gameId, { preview })
      .then(() => {
        if (cancelled) return;
        // A fresh session starts at gain 1.0 backend-side — re-apply the
        // user's persisted volume (and any attract duck) immediately.
        void setNativeVolume(effectiveGainRef.current).catch(() => undefined);
        frameHandle = requestAnimationFrame(paintNextFrame);
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
      window.removeEventListener("focus", onFocus);
      void setNativeInput(0).catch(() => undefined); // release all buttons before tearing down
      void stopNativePlay();
    };
    // Intentionally re-subscribes per gameId/preview only (open/close
    // callbacks are stable): flipping into or out of "preview" must reboot
    // the session, since save wiring is fixed at session start — a save-less
    // preview core can never silently become the user's persisted session.
    // Foreground<->background attract flips keep `preview` constant, so the
    // W235 handoff still never reboots.
  }, [gameId, preview]);

  // W273: a preview is a pure spectator surface — the bare canvas only. No
  // Continue button, no chip bar, no overlay (the overlay could save/load
  // state, which a no-trace session must never offer).
  return (
    <div className={playerShellClass(presentation)}>
      <div className="rgp-player__frame">
        <canvas ref={canvasRef} className="rgp-native-player__canvas" aria-label={`Play ${gameName}`} />
      </div>
      {!preview && (
        <div className="rgp-player__bar">
          {continueTarget && (
            <button type="button" className="rgp-player__fs" onClick={onContinue}>
              ⟳ Continue
            </button>
          )}
          <button type="button" className="rgp-player__fs" onClick={openOverlay}>
            ☰ Menu
          </button>
          <button type="button" className="rgp-player__fs" onClick={exitGame}>
            ✕ Exit
          </button>
        </div>
      )}

      {!preview && (
        <PlayerOverlay
          gameName={gameName}
          open={overlayOpen}
          items={items}
          selection={selection}
          setSelection={setSelection}
          onScrimClick={closeOverlay}
          status={status}
          hint="Esc or ☰ to toggle"
          volume={{ value: prefs.volume, onChange: prefs.setVolume }}
        />
      )}
    </div>
  );
}
