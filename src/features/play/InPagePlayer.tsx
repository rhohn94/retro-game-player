// InPagePlayer — runs a supported game's EmulatorJS core inside the Retro Game
// Player detail screen (v0.15, features #6/#7/#8).
//
// The emulator runs in an <iframe> on the loopback play origin (see the Rust
// `play::server`) because EmulatorJS's Worker/WASM pipeline doesn't work under
// the `tauri://` scheme. On top of that:
//
//  * #8 in-page play: the game auto-boots on entry (player.html sets
//    EJS_startOnLoaded) with sound.
//  * #6 in-game overlay + immersive mode: while the player is mounted
//    foreground it owns the controller (the gamepad belongs to the game) via
//    the SHARED exclusive-controller scope (useExclusiveControllerScope,
//    v0.27 W272). The menu/Start button or Escape opens an in-app overlay —
//    Resume / Full screen / Exit — that pauses the emulator (so the gamepad
//    doesn't drive the game behind the menu); every other semantic action is
//    swallowed while the overlay is closed (EmulatorJS reads the gamepad
//    itself inside the iframe, so game input never rides semantic actions).
//    "Full screen" is the app's immersive mode (window fullscreen + the player
//    fills the viewport over the app chrome) rather than iframe element-
//    fullscreen, so the overlay can render over the running game.
//  * #7 seamless transitions: the frame fades in as the game boots and the
//    overlay animates in/out.
//
// Teardown is unmounting the iframe (disposes the emulator, audio, workers).

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPlayOrigin } from "../../ipc/play";
import type { SaveSlot } from "../../ipc/native-play";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { listGameSaves } from "../../ipc/native-play";
import { PlayerOverlay } from "./PlayerOverlay";
import { playerShellClass, type PlayerPresentation } from "./presentation";
import { usePlayerPrefs } from "./playerPrefs";
import { usePlaySession } from "./playSession";
import { continueSlot } from "./saveSlots";
import { useExclusiveControllerScope } from "./useExclusiveControllerScope";
import { useOverlayMenu } from "./useOverlayMenu";

/** How long a save/load round-trip to the game iframe may take before the
 * overlay reports it failed (the bridge answers in milliseconds normally). */
const SAVE_RESULT_TIMEOUT_MS = 5000;

/** Toggle the Tauri window's fullscreen; a no-op outside Tauri (browser/mock). */
async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(on);
  } catch {
    /* not running under Tauri — immersive still works as a CSS fill */
  }
}

export interface InPagePlayerProps {
  gameId: number;
  /** EmulatorJS system key (from `inPageSystem`), e.g. "nes". */
  ejsSystem: string;
  /** Display name passed to EmulatorJS (UI title, save-state id). */
  gameName: string;
  /** Called once if the play server is unavailable (origin "") — the caller
   * surfaces the degradation (W234); this player renders nothing. */
  onUnavailable?: () => void;
  /** How "Exit game" leaves (v0.26 W265). Default (desktop detail route):
   * `navigate(-1)`. The TV takeover surface supplies its own callback so exit
   * collapses the takeover back to the tile instead of popping router history. */
  onExit?: () => void;
  /** How the player is presented (v0.27 W272). The TV takeover passes
   * "takeover" (edge-to-edge fill, TV-scale overlay chrome); the desktop
   * detail route omits it ("foreground"). "background" never reaches this
   * player — PlaySwitch normalizes it away (the EmulatorJS iframe cannot
   * become a page background; explicit v0.23 non-goal) — but if it ever did,
   * the shared controller scope would correctly release the slot. */
  presentation?: PlayerPresentation;
}

/** Mounts the in-page emulator for one game; auto-starts on load. */
export function InPagePlayer({
  gameId,
  ejsSystem,
  gameName,
  onUnavailable,
  onExit,
  presentation = "foreground",
}: InPagePlayerProps) {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Library-life play-session tracking (v0.26 W264): the session brackets
  // this player's whole mounted lifetime, not just the time the iframe has
  // successfully loaded — matching the design doc's "in-page (mount/unmount)"
  // hook point.
  usePlaySession(gameId);

  // null = resolving the play origin; "" = server unavailable; else the origin.
  const [origin, setOrigin] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [selection, setSelection] = useState(0);

  // Live mirrors so the controller handler (installed once) reads current state.
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;

  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  useCancellableEffect((isCancelled) => {
    getPlayOrigin()
      .then((o) => {
        if (isCancelled()) return;
        setOrigin(o);
        if (o === "") onUnavailableRef.current?.();
      })
      .catch(() => {
        if (isCancelled()) return;
        setOrigin("");
        onUnavailableRef.current?.();
      });
  }, []);

  /** Send a control message to the emulator iframe (same loopback origin). */
  const postToGame = useCallback(
    (type: string, extra?: Record<string, unknown>) => {
      if (origin && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type, ...extra }, origin);
      }
    },
    [origin],
  );

  // Save/load round-trips to the game iframe (W232): the player.html bridge
  // answers each harmony-save-state / harmony-load-state request with a
  // harmony-save-result — correlate by op+slot so the overlay can await it.
  const pendingSaves = useRef(new Map<string, (error: string | null) => void>());
  const requestSaveOp = useCallback(
    (op: "save" | "load", slot: SaveSlot) =>
      new Promise<void>((resolve, reject) => {
        const key = `${op}:${slot}`;
        const timer = window.setTimeout(() => {
          pendingSaves.current.delete(key);
          reject(new Error("the game did not answer — try again"));
        }, SAVE_RESULT_TIMEOUT_MS);
        pendingSaves.current.set(key, (error) => {
          window.clearTimeout(timer);
          pendingSaves.current.delete(key);
          if (error) reject(new Error(error));
          else resolve();
        });
        postToGame(op === "save" ? "harmony-save-state" : "harmony-load-state", { slot });
      }),
    [postToGame],
  );

  // Stable postMessage handle so once-installed callbacks (prefs hook,
  // blur handlers) always target the current iframe/origin.
  const postRef = useRef(postToGame);
  postRef.current = postToGame;

  // Player prefs (W243): volume changes stream to the game bridge; the
  // initial value lands via the same channel once the emulator starts
  // (player.html holds it until then). Pause-on-blur reads the pref live.
  const prefs = usePlayerPrefs((volume) => postRef.current("harmony-volume", { value: volume }));
  const pauseOnBlurRef = useRef(true);
  pauseOnBlurRef.current = prefs.pauseOnBlur;
  const volumeRef = useRef(1);
  volumeRef.current = prefs.volume;
  const [fastForward, setFastForward] = useState(false);

  const openOverlay = useCallback(() => {
    setSelection(0);
    setOverlayOpen(true);
    postToGame("harmony-pause");
  }, [postToGame]);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    postToGame("harmony-resume");
  }, [postToGame]);

  const toggleOverlay = useCallback(() => {
    if (overlayOpenRef.current) closeOverlay();
    else openOverlay();
  }, [openOverlay, closeOverlay]);

  // "Continue" (W232): restore the newest EJS-written state into the
  // freshly-booted session. Dismisses itself once used.
  const [continueTarget, setContinueTarget] = useState<SaveSlot | null>(null);
  useCancellableEffect(
    (isCancelled) => {
      listGameSaves(gameId)
        .then((saves) => {
          if (isCancelled()) return;
          setContinueTarget((continueSlot(saves, "ejs")?.slot as SaveSlot | undefined) ?? null);
        })
        .catch(() => undefined);
    },
    [gameId],
  );
  const onContinue = useCallback(() => {
    const slot = continueTarget;
    if (!slot) return;
    requestSaveOp("load", slot)
      .then(() => setContinueTarget(null))
      .catch(() => undefined);
  }, [continueTarget, requestSaveOp]);

  const enterImmersive = useCallback(() => {
    setImmersive(true);
    void setWindowFullscreen(true);
  }, []);

  const exitImmersive = useCallback(() => {
    setImmersive(false);
    void setWindowFullscreen(false);
  }, []);

  // Keep the latest onExit reachable from the stable overlay-menu callback
  // without re-installing the whole menu on every parent render.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const exitGame = useCallback(() => {
    void setWindowFullscreen(false);
    // TV takeover supplies its own exit (collapse to the tile); the desktop
    // detail route falls back to popping history back to the grid.
    if (onExitRef.current) onExitRef.current();
    else navigate(-1);
  }, [navigate]);

  // Overlay menu (index order drives controller selection): Resume / Save
  // state / Load state / Full screen / Exit, with the slot sub-views owned
  // by the shared menu hook (W232).
  const { items, status, resetView } = useOverlayMenu({
    gameId,
    activePath: "ejs",
    open: overlayOpen,
    resume: { key: "resume", label: "Resume", run: () => closeOverlay() },
    extras: [
      // EJS-only conveniences (W243, #22): rewind + fast-forward ride the
      // emulator's built-ins via the player.html bridge; mute rides the
      // shared persisted volume. The native path hides all three (rewind/FF
      // need the frame-history machinery only EmulatorJS has today).
      {
        key: "rewind",
        label: "⏪ Rewind 5 s",
        run: () => {
          closeOverlay(); // watch the rewind happen
          postToGame("harmony-rewind", { seconds: 5 });
        },
      },
      {
        key: "fastforward",
        label: fastForward ? "⏩ Fast-forward: on" : "⏩ Fast-forward: off",
        run: () => {
          const next = !fastForward;
          setFastForward(next);
          postToGame("harmony-fastforward", { active: next });
        },
      },
      {
        key: "mute",
        label: prefs.volume === 0 ? "🔇 Unmute" : "🔇 Mute",
        run: () => prefs.toggleMute(),
      },
      {
        key: "immersive",
        label: immersive ? "Exit full screen" : "Full screen",
        run: () => {
          if (immersiveRef.current) exitImmersive();
          else enterImmersive();
          closeOverlay();
        },
      },
    ],
    exit: { key: "exit", label: "Exit game", run: () => exitGame() },
    saveSlot: (slot) => requestSaveOp("save", slot),
    loadSlot: (slot) => requestSaveOp("load", slot),
    onLoaded: () => closeOverlay(),
    onViewChange: () => setSelection(0),
  });

  // Back to the main view whenever the overlay opens fresh.
  useEffect(() => {
    if (overlayOpen) resetView();
  }, [overlayOpen, resetView]); // resetView is a stable callback

  // While a REAL player is active (origin resolved — unavailable "" or
  // still-resolving null must not trap input) and foreground-presented, it
  // owns the controller via the shared exclusive scope (W272): menu summons
  // the overlay, every other semantic action is swallowed; with the overlay
  // open the controller drives the menu (the game is paused behind it).
  useExclusiveControllerScope({
    presentation,
    ready: !!origin,
    overlayOpen,
    items,
    selection,
    setSelection,
    openOverlay,
    closeOverlay,
  });

  // Escape opens the overlay from the keyboard — directly when the app holds
  // focus, and via a forwarded postMessage when the game iframe holds focus.
  useEffect(() => {
    if (!origin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        toggleOverlay();
      }
    };
    const onMsg = (e: MessageEvent) => {
      if (!origin || e.origin !== origin) return;
      const data = e.data as { type?: string; op?: string; slot?: string; error?: string | null };
      if (data?.type === "harmony-overlay-toggle") {
        toggleOverlay();
      } else if (data?.type === "harmony-save-result" && data.op && data.slot) {
        pendingSaves.current.get(`${data.op}:${data.slot}`)?.(data.error ?? null);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMsg);
    };
  }, [origin, toggleOverlay]);

  // Pause-on-blur (W243): freeze the game when the window loses focus,
  // resume on refocus — unless the overlay already owns the pause.
  useEffect(() => {
    if (!origin) return;
    let blurPaused = false;
    const onBlur = () => {
      if (pauseOnBlurRef.current && !overlayOpenRef.current) {
        blurPaused = true;
        postRef.current("harmony-pause");
      }
    };
    const onFocus = () => {
      if (!blurPaused) return;
      blurPaused = false;
      if (!overlayOpenRef.current) postRef.current("harmony-resume");
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [origin]);

  // Always leave fullscreen if the player unmounts (SPA navigation away).
  useEffect(() => () => void setWindowFullscreen(false), []);

  if (origin === null) {
    return (
      <div className={playerShellClass(presentation)}>
        <div className="rgp-player__frame" />
      </div>
    );
  }
  if (origin === "") return null;

  const src =
    `${origin}/player.html?core=${encodeURIComponent(ejsSystem)}` +
    `&game=${gameId}&name=${encodeURIComponent(gameName)}`;

  return (
    <div className={playerShellClass(presentation, immersive)}>
      <iframe
        ref={iframeRef}
        className="rgp-player__frame"
        src={src}
        title={`Play ${gameName}`}
        allow="autoplay; fullscreen; gamepad"
      />

      {!immersive && (
        <div className="rgp-player__bar">
          {continueTarget && (
            <button type="button" className="rgp-player__fs" onClick={onContinue}>
              ⟳ Continue
            </button>
          )}
          <button type="button" className="rgp-player__fs" onClick={enterImmersive}>
            ⤢ Full screen
          </button>
          <button type="button" className="rgp-player__fs" onClick={openOverlay}>
            ☰ Menu
          </button>
        </div>
      )}

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
    </div>
  );
}
