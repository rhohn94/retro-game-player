// useAutoTvModeOnStartup — reads the persisted `auto_tv_mode` AppConfig flag
// once on mount and enters TV mode if it's set (v0.26 W260,
// tv-mode-design.md §Auto-enter: "on mount, App.tsx reads config and calls
// enter() once when set"). Extracted into its own hook (rather than an inline
// effect in App.tsx) so the one-time-read-then-maybe-enter behavior has a
// single-responsibility home and its own summary comment, per
// docs/coding-standards.md.

import { getAutoTvMode } from "../../ipc/app-config";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import type { TvModeContextValue } from "./TvModeContext";

/**
 * Reads `auto_tv_mode` from the backend exactly once on mount and calls
 * `tvMode.enter()` if it's `true`. A failed/absent IPC read (e.g. outside a
 * Tauri webview) degrades silently to "stay on the desktop" — auto-enter is a
 * convenience, never a hard requirement to boot the app.
 */
export function useAutoTvModeOnStartup(tvMode: Pick<TvModeContextValue, "enter">): void {
  useCancellableEffect((isCancelled) => {
    getAutoTvMode()
      .then((enabled) => {
        if (!isCancelled() && enabled) tvMode.enter();
      })
      .catch(() => {
        /* No config / not in Tauri — stay on the desktop shell. */
      });
    // Run once on mount only; `tvMode.enter` is a stable useCallback from
    // TvModeProvider (memoized dep list intentionally omits it).
  }, []);
}
