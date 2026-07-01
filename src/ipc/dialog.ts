// Typed wrapper for the `@tauri-apps/plugin-dialog` domain (W225). Feature
// components import from here rather than the plugin directly, so the IPC/
// native-plugin boundary stays confined to `src/ipc/`.

import { open as pluginOpen, type OpenDialogOptions, type OpenDialogReturn } from "@tauri-apps/plugin-dialog";

/** Open the native file/folder picker. Mirrors the plugin's own signature. */
export function openFileDialog<T extends OpenDialogOptions>(
  options?: T,
): Promise<OpenDialogReturn<T>> {
  return pluginOpen(options);
}
