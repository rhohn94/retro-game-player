/**
 * Personal vs Global catalog mode preference (Library).
 * Pure localStorage helpers.
 */

const KEY = "rgp.library.catalogMode";

export type CatalogMode = "personal" | "global";

export function loadCatalogMode(): CatalogMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "global" || v === "personal") return v;
  } catch {
    // ignore
  }
  return "personal";
}

export function saveCatalogMode(mode: CatalogMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // ignore
  }
}

const CONSOLE_KEY = "rgp.library.globalConsole";

export function loadGlobalConsoleKey(fallback: string): string {
  try {
    const v = localStorage.getItem(CONSOLE_KEY);
    if (v) return v;
  } catch {
    // ignore
  }
  return fallback;
}

export function saveGlobalConsoleKey(key: string): void {
  try {
    localStorage.setItem(CONSOLE_KEY, key);
  } catch {
    // ignore
  }
}
