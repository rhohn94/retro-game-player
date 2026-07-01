// Typed wrappers for the `@tauri-apps/plugin-opener` domain (W225). Feature
// components import from here rather than the plugin directly, so the IPC/
// native-plugin boundary stays confined to `src/ipc/`.

import {
  openUrl as pluginOpenUrl,
  revealItemInDir as pluginRevealItemInDir,
} from "@tauri-apps/plugin-opener";

/** Open `url` in the user's default browser (or OS default handler). */
export function openUrl(url: string): Promise<void> {
  return pluginOpenUrl(url);
}

/** Reveal `path` in the OS file manager (Finder on macOS). */
export function revealItemInDir(path: string): Promise<void> {
  return pluginRevealItemInDir(path);
}
