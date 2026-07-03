// General AppConfig IPC (v0.26 W260, tv-mode-design.md §Auto-enter) — mirrors
// the Rust `commands::app_config` surface. Currently covers `auto_tv_mode`:
// the Settings → Appearance "Start in TV mode" toggle reads/writes it, and
// App.tsx reads it once on startup to decide whether to auto-enter TV mode.

import { invoke } from "./invoke";

/** Whether the app should land directly in TV mode on a fresh launch. */
export function getAutoTvMode(): Promise<boolean> {
  return invoke<boolean>("get_auto_tv_mode");
}

/** Persists the auto-TV-mode startup preference. */
export function setAutoTvMode(enabled: boolean): Promise<void> {
  return invoke<void>("set_auto_tv_mode", { enabled });
}
