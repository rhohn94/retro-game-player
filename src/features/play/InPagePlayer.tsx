// InPagePlayer — runs a supported game's EmulatorJS core inside the Harmony
// detail screen (v0.15, features #6/#7/#8).
//
// The emulator runs in an <iframe> on the loopback play origin (see the Rust
// `play::server`) because EmulatorJS's Worker/WASM pipeline doesn't work under
// the `tauri://` scheme. On top of that:
//
//  * #8 in-page play: the game auto-boots on entry (player.html sets
//    EJS_startOnLoaded) with sound.
//  * #6 in-game overlay + immersive mode: while the player is mounted it owns the
//    controller (the gamepad belongs to the game). The menu/Start button, the
//    controller "back", or Escape open a Harmony overlay — Resume / Full screen /
//    Exit — that pauses the emulator (so the gamepad doesn't drive the game
//    behind the menu) and traps input via the controller exclusive handler.
//    "Full screen" is a Harmony immersive mode (window fullscreen + the player
//    fills the viewport over the app chrome) rather than iframe element-
//    fullscreen, so the overlay can render over the running game.
//  * #7 seamless transitions: the frame fades in as the game boots and the
//    overlay animates in/out.
//
// Teardown is unmounting the iframe (disposes the emulator, audio, workers).

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useController } from "../controller";
import type { SemanticAction } from "../controller/actions";
import { getPlayOrigin } from "../../ipc/play";
import type { SaveSlot } from "../../ipc/native-play";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { listGameSaves } from "../../ipc/native-play";
import { PlayerOverlay } from "./PlayerOverlay";
import { continueSlot } from "./saveSlots";
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
}

/** Mounts the in-page emulator for one game; auto-starts on load. */
export function InPagePlayer({ gameId, ejsSystem, gameName }: InPagePlayerProps) {
  const navigate = useNavigate();
  const { setExclusiveHandler } = useController();
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useCancellableEffect((isCancelled) => {
    getPlayOrigin()
      .then((o) => !isCancelled() && setOrigin(o))
      .catch(() => !isCancelled() && setOrigin(""));
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

  const exitGame = useCallback(() => {
    void setWindowFullscreen(false);
    navigate(-1);
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
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Back to the main view whenever the overlay opens fresh.
  useEffect(() => {
    if (overlayOpen) resetView();
  }, [overlayOpen, resetView]); // resetView is a stable callback

  // While the player is mounted it owns the controller: the gamepad drives the
  // game, and menu/back summon the overlay; when the overlay is open the gamepad
  // drives the menu (the game is paused).
  useEffect(() => {
    // Only capture the controller while a real player is active. When the play
    // server is unavailable (origin "") or still resolving (null) the page shows
    // no player, so it must NOT trap controller input.
    if (!origin) return;
    const handler = (action: SemanticAction) => {
      if (!overlayOpenRef.current) {
        if (action === "menu" || action === "back") openOverlay();
        return;
      }
      const n = itemsRef.current.length;
      if (action === "nav_up") setSelection((s) => (s - 1 + n) % n);
      else if (action === "nav_down") setSelection((s) => (s + 1) % n);
      else if (action === "confirm") {
        const item = itemsRef.current[selectionRef.current];
        if (item && !item.disabled) item.run();
      }
      else if (action === "back" || action === "menu") closeOverlay();
    };
    setExclusiveHandler(handler);
    return () => setExclusiveHandler(null);
  }, [origin, setExclusiveHandler, openOverlay, closeOverlay]);

  // Escape opens the overlay from the keyboard — directly when Harmony holds
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

  // Always leave fullscreen if the player unmounts (SPA navigation away).
  useEffect(() => () => void setWindowFullscreen(false), []);

  if (origin === null) {
    return (
      <div className="harmony-player">
        <div className="harmony-player__frame" />
      </div>
    );
  }
  if (origin === "") return null;

  const src =
    `${origin}/player.html?core=${encodeURIComponent(ejsSystem)}` +
    `&game=${gameId}&name=${encodeURIComponent(gameName)}`;

  return (
    <div className={immersive ? "harmony-player harmony-player--immersive" : "harmony-player"}>
      <iframe
        ref={iframeRef}
        className="harmony-player__frame"
        src={src}
        title={`Play ${gameName}`}
        allow="autoplay; fullscreen; gamepad"
      />

      {!immersive && (
        <div className="harmony-player__bar">
          {continueTarget && (
            <button type="button" className="harmony-player__fs" onClick={onContinue}>
              ⟳ Continue
            </button>
          )}
          <button type="button" className="harmony-player__fs" onClick={enterImmersive}>
            ⤢ Full screen
          </button>
          <button type="button" className="harmony-player__fs" onClick={openOverlay}>
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
      />
    </div>
  );
}
