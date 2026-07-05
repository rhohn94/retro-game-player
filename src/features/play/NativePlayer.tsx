// NativePlayer — runs a game via the app's native libretro core host
// (v0.21 "Bedrock") instead of EmulatorJS. The Rust backend owns the entire
// emulation loop and the audio device (play::native::NativeRuntime); this
// component starts/stops that session, paints whatever frame it last
// produced onto a <canvas>, and pushes keyboard/gamepad state into the
// core's input (W216 — see nativeInput.ts).
//
// v0.29 W280 (crt-filter-design.md): the paint step draws through a WebGL2
// pipeline (CrtWebglRenderer) instead of Canvas2D `putImageData` — each
// polled frame uploads as a texture and is drawn through a combined
// scanline/curvature/color-bleed/vignette fragment shader, parameterized by
// the shared CRT filter config (useCrtFilter). If WebGL2 is unavailable on
// this canvas, painting falls back to plain `putImageData` (no filter, but
// never a blank screen — same "never a dead end" posture as the EJS
// automatic fallback elsewhere in this app).
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
  releaseAllNativeInput,
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
import { CrtWebglRenderer } from "./crtWebglRenderer";
import { useCrtFilter } from "./useCrtFilter";
import { FpsCounter } from "./fpsCounter";
import { FpsCounterOverlay } from "./FpsCounterOverlay";
import { useShowFpsCounter } from "./useShowFpsCounter";
import { assignPorts, connectedPortCount, emptyAssignments, padForPort } from "./gamepadAssignment";
import { MenuHoldIndicator } from "./MenuHoldIndicator";
import { parseFrameBuffer } from "./nativeFrame";
import { computeJoypadBits, isBoundKey } from "./nativeInput";
import { PlayerOverlay } from "./PlayerOverlay";
import { PlayerCountIndicator } from "./PlayerCountIndicator";
import { PortInputPusher } from "./portInputPusher";
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

/** Shared empty key set for ports other than 0 — keyboard only ever drives
 * port 0 (v0.35 W351, controller-input-design.md §Two-player capture), so
 * every other port's `computeJoypadBits` call passes this instead of
 * allocating a fresh empty `Set` every poll tick. */
const EMPTY_HELD_KEYS: ReadonlySet<string> = new Set();

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
  // v0.34 W345: the polled frame's real display aspect ratio (fixing the
  // W340 reviewer note that this was logged backend-side but never reached
  // the frontend) — `null` until the first frame lands (or for a system
  // that never sets one, e.g. NES), in which case the CSS default (4/3)
  // applies via `--rgp-player-aspect-ratio`'s fallback (library.css).
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  // v0.28 W279: live progress (0..1) toward the hold-to-open-menu threshold —
  // drives MenuHoldIndicator below; reported by useExclusiveControllerScope's
  // raw-poll trigger, reset to 0 on release/chord/open.
  const [holdProgress, setHoldProgress] = useState(0);
  // v0.35 W351: how many ports currently have a GAMEPAD assigned (keyboard
  // isn't counted — it merges into port 0 alongside pad 0, it doesn't claim
  // a slot) — drives the quiet "P1"/"P1 P2" indicator
  // (controller-input-design.md §Two-player capture). Updated live from the
  // same poll tick that computes per-port input, so it tracks
  // connect/disconnect without a separate listener — and unlike the input
  // PUSHES it is never gated on the overlay/spectator state, so a second pad
  // plugging in at the pause menu updates the overlay-hosted indicator
  // immediately.
  const [connectedPadCount, setConnectedPadCount] = useState(0);

  // W273: a preview session is a no-trace spectator session end-to-end —
  // `preview` gates the backend save wiring (below) and the play-session
  // record; `spectator` (background OR preview) gates input + the audio duck.
  const preview = presentation === "preview";
  const spectator = presentationIsSpectator(presentation);

  // v0.29 W280: the shared CRT filter config — read-only here (the settings
  // panel owns writes). The frame-painting effect below reads it via a ref
  // so a slider drag never re-subscribes the whole polling effect.
  const { config: crtConfig } = useCrtFilter();
  const crtConfigRef = useRef(crtConfig);
  crtConfigRef.current = crtConfig;

  // v0.29 W281 (performance-tooling-design.md): the optional on-screen FPS
  // counter, computed client-side from this player's own paint-loop rAF
  // ticks (see `paintNextFrame` below) — never a shared IPC field, since the
  // native core's true tick rate is a different signal than the EJS path's
  // rendered cadence.
  const showFpsCounter = useShowFpsCounter();
  const showFpsCounterRef = useRef(showFpsCounter);
  showFpsCounterRef.current = showFpsCounter;
  const [fps, setFps] = useState(0);

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
      void releaseAllNativeInput().catch(() => undefined); // v0.35 W351: release every port, not just port 0
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
    void releaseAllNativeInput().catch(() => undefined); // v0.35 W351: release held buttons on every port
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
    onHoldProgress: setHoldProgress,
  });

  useEffect(() => {
    let cancelled = false;
    let frameHandle = 0;
    const heldKeys = new Set<string>();
    // v0.35 W351: memoized per-port mask delivery (portInputPusher.ts, sized
    // from NUM_NATIVE_PLAY_PORTS) — each port's IPC push is independently
    // short-circuited (a change on port 1 must not force a redundant re-send
    // on port 0's unchanged mask), a disconnected port's zero-mask release
    // sends exactly once, and a push the IPC layer rejects retries next tick.
    const inputPusher = new PortInputPusher(setNativeInput);
    let portAssignments = emptyAssignments();
    // v0.34 W345: a fresh session starts back at "unknown aspect" (the CSS
    // 4/3 default) until its first real frame reports one — a game switch
    // must never keep rendering the PREVIOUS game's aspect box.
    setAspectRatio(null);

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
      // v0.35 W351: poll ALL connected pads and assign them to ports EVERY
      // tick (gamepadAssignment.ts — first-connected -> port 0, second ->
      // port 1, keyed by stable Gamepad.index; a later reconnect claims the
      // lowest free port). This recompute deliberately runs above the
      // overlay/spectator gate below: the pause menu hosts the live
      // PlayerCountIndicator, and a second player plugging in AT the menu
      // (the natural moment to do so) must see "P2" appear without having to
      // close it first.
      const connected = navigator.getGamepads?.() ?? [];
      portAssignments = assignPorts(connected, portAssignments);
      setConnectedPadCount((count) => {
        const next = connectedPortCount(portAssignments);
        return next === count ? count : next;
      });

      // Paused behind the overlay or spectating — nothing reaches the core.
      // Both transitions already released every port (releaseAllNativeInput
      // in openOverlay / the spectator effect), so a pad disconnecting while
      // gated owes no zero push of its own; marking the pusher released
      // keeps its per-port memo aligned with that all-zero backend state, so
      // ungating re-sends any mask still physically held (and a port whose
      // pad left while gated correctly re-sends nothing).
      if (overlayOpenRef.current || spectatorRef.current) {
        inputPusher.markAllReleased();
        return;
      }

      for (let port = 0; port < portAssignments.length; port++) {
        const gamepad = padForPort(connected, portAssignments, port);
        // Keyboard always merges into port 0 alongside pad 0 (controller-input-design.md
        // §Two-player capture) — every other port reflects its pad alone.
        // A port whose pad just disconnected recomputes to a zero mask here,
        // which the pusher sends exactly once (and retries if the IPC push
        // rejects — a failed release must never leave a stale mask held).
        const bits = computeJoypadBits(port === 0 ? heldKeys : EMPTY_HELD_KEYS, gamepad);
        inputPusher.push(port, bits);
      }
    };

    // v0.29 W280: paint through the WebGL2 CRT pipeline, built lazily against
    // whatever <canvas> the ref holds by the first frame. If WebGL2 is
    // unavailable on this canvas (old GPU/driver, context budget exhausted),
    // fall back to the pre-W280 plain `putImageData` paint — a missing
    // filter is a graceful degradation, never a blank screen. Tried at most
    // once per mount; a construction failure doesn't retry every frame.
    let renderer: CrtWebglRenderer | null = null;
    let webglAttempted = false;

    // v0.29 W281: sampled from the SAME rAF tick that already drives the
    // frame poll/paint below — the cleanest available signal for "how often
    // is this player actually presenting a new frame", independent of
    // whether the WebGL2 or the putImageData fallback path painted it. A
    // fresh counter per mount so a game switch doesn't carry over a stale
    // estimate.
    const fpsCounter = new FpsCounter();
    let lastFpsPublished = 0;
    const FPS_PUBLISH_INTERVAL_MS = 500; // matches FpsCounter's own recompute cadence

    // v0.34 W345: the last aspect ratio published to React state, so a
    // steady 60 Hz stream of identical-aspect frames (the overwhelming
    // common case — aspect only changes on a genuine geometry
    // renegotiation) never re-renders this component every tick.
    let lastPublishedAspectRatio: number | null = null;

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
          if (frame.aspectRatio !== lastPublishedAspectRatio) {
            lastPublishedAspectRatio = frame.aspectRatio;
            setAspectRatio(frame.aspectRatio);
          }

          if (!webglAttempted) {
            webglAttempted = true;
            try {
              renderer = new CrtWebglRenderer(canvas);
            } catch {
              // Construction failure (CrtWebglUnavailableError, a compile/link
              // error) — `renderer` stays null, so the branch below degrades
              // to the plain 2D paint for the rest of this mount rather than
              // retrying (and logging) every single frame.
            }
          }
          if (renderer) {
            renderer.draw(frame.bytes, frame.width, frame.height, crtConfigRef.current);
          } else {
            canvas.getContext("2d")?.putImageData(new ImageData(frame.bytes, frame.width, frame.height), 0, 0);
          }

          // v0.29 W281: count this tick only when a genuinely new frame was
          // painted (not every rAF — most ticks find nothing new via the
          // seq-echo short-circuit above), so the estimate reflects actual
          // presentation cadence, not the poll rate. Publishing to React
          // state is throttled independently of FpsCounter's own recompute
          // window so a disabled counter never re-renders this component.
          if (showFpsCounterRef.current) {
            const now = performance.now();
            fpsCounter.tick(now);
            if (now - lastFpsPublished >= FPS_PUBLISH_INTERVAL_MS) {
              lastFpsPublished = now;
              setFps(fpsCounter.fps);
            }
          }
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
      void releaseAllNativeInput().catch(() => undefined); // v0.35 W351: release every port before tearing down
      void stopNativePlay();
      renderer?.dispose(); // free the GL texture/VAO/program before the canvas unmounts
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
  // v0.34 W345: only override the CSS aspect-ratio custom property once a
  // real ratio is known — `undefined` leaves the CSS default (4/3) in
  // effect, matching every pre-W345 system (NES included) exactly.
  const frameStyle = aspectRatio ? ({ "--rgp-player-aspect-ratio": aspectRatio } as React.CSSProperties) : undefined;

  return (
    <div className={playerShellClass(presentation)}>
      <div className="rgp-player__frame" style={frameStyle}>
        <canvas ref={canvasRef} className="rgp-native-player__canvas" aria-label={`Play ${gameName}`} />
      </div>
      {!preview && !overlayOpen && <MenuHoldIndicator progress={holdProgress} />}
      {!preview && <FpsCounterOverlay enabled={showFpsCounter} fps={fps} />}
      {!preview && (
        <div className="rgp-player__bar">
          <PlayerCountIndicator connectedPadCount={connectedPadCount} />
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
          connectedPadCount={connectedPadCount}
        />
      )}
    </div>
  );
}
