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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useController } from "../controller";
import type { SemanticAction } from "../controller/actions";
import { DUR, dialogPop } from "../../lib/motion";
import { getPlayOrigin } from "../../ipc/play";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";

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
    (type: string) => {
      if (origin && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type }, origin);
      }
    },
    [origin],
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

  // Overlay menu items (index order drives controller selection).
  const items = useMemo(
    () => [
      { key: "resume", label: "Resume", run: () => closeOverlay() },
      {
        key: "immersive",
        label: immersive ? "Exit full screen" : "Full screen",
        run: () => {
          if (immersiveRef.current) exitImmersive();
          else enterImmersive();
          closeOverlay();
        },
      },
      { key: "exit", label: "Exit game", run: () => exitGame() },
    ],
    [immersive, closeOverlay, enterImmersive, exitImmersive, exitGame],
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
      else if (action === "confirm") itemsRef.current[selectionRef.current]?.run();
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
      if (origin && e.origin === origin && (e.data as { type?: string })?.type === "harmony-overlay-toggle") {
        toggleOverlay();
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
          <button type="button" className="harmony-player__fs" onClick={enterImmersive}>
            ⤢ Full screen
          </button>
          <button type="button" className="harmony-player__fs" onClick={openOverlay}>
            ☰ Menu
          </button>
        </div>
      )}

      <AnimatePresence>
        {overlayOpen && (
          <motion.div
            className="harmony-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast }}
            onClick={(e) => {
              if (e.target === e.currentTarget) closeOverlay();
            }}
          >
            <motion.div className="harmony-overlay__panel" {...dialogPop}>
              <p className="harmony-overlay__title">{gameName}</p>
              <div className="harmony-overlay__actions">
                {items.map((it, i) => (
                  <button
                    key={it.key}
                    type="button"
                    className={
                      i === selection
                        ? "harmony-overlay__btn harmony-overlay__btn--active"
                        : "harmony-overlay__btn"
                    }
                    onMouseEnter={() => setSelection(i)}
                    onClick={() => it.run()}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
              <p className="harmony-overlay__hint">Esc or ☰ to toggle · save states live in the player bar</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
