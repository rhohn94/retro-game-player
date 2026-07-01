// useFullscreen — toggle the Harmony window in/out of OS fullscreen (v0.14, #2).
//
// A "full screen experience" for couch / big-picture use: the whole Harmony UI
// fills the display. Backed by Tauri's window API (`core:window:allow-set-
// fullscreen` capability). Pressing F11 anywhere toggles it; the shell also
// renders a button bound to `toggle`. Everything is guarded so the hook is a
// no-op outside a Tauri webview (tests / headless inspection), where the window
// API is unavailable.

import { useCallback, useEffect, useState } from "react";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";

/** Resolve the current window handle, or null outside a Tauri webview. */
async function currentWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export interface UseFullscreenResult {
  /** Whether the window is currently fullscreen (best-effort; false until known). */
  isFullscreen: boolean;
  /** Flip fullscreen on/off. */
  toggle: () => void;
  /** Force a specific fullscreen state. */
  setFullscreen: (on: boolean) => void;
}

/**
 * Manage the window's fullscreen state and bind F11 to toggle it. Mount once at
 * the app shell. Returns the live state plus `toggle`/`setFullscreen` so UI
 * controls (and, later, the controller) can drive it too.
 */
export function useFullscreen(): UseFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync the initial state from the real window (best-effort).
  useCancellableEffect((isCancelled) => {
    void (async () => {
      const win = await currentWindow();
      if (!win) return;
      try {
        const on = await win.isFullscreen();
        if (!isCancelled()) setIsFullscreen(on);
      } catch {
        /* window API unavailable — leave the default. */
      }
    })();
  }, []);

  const setFullscreen = useCallback((on: boolean) => {
    void (async () => {
      const win = await currentWindow();
      if (!win) return;
      try {
        await win.setFullscreen(on);
        setIsFullscreen(on);
      } catch {
        /* not in a Tauri webview — ignore. */
      }
    })();
  }, []);

  const toggle = useCallback(() => {
    setIsFullscreen((cur) => {
      void (async () => {
        const win = await currentWindow();
        if (!win) return;
        try {
          await win.setFullscreen(!cur);
        } catch {
          /* ignore */
        }
      })();
      return !cur;
    });
  }, []);

  // F11 toggles fullscreen anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return { isFullscreen, toggle, setFullscreen };
}
