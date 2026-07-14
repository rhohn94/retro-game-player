/**
 * Local search UX preferences (Phase 2 query-suffix preset, etc.).
 * Pure localStorage helpers — no React.
 */

const APPEND_ROM_KEY = "rgp.search.appendRom";

/** Default ON: meta-search ranks downloadable hits better with a `rom` token. */
export function loadAppendRomPref(): boolean {
  try {
    const v = localStorage.getItem(APPEND_ROM_KEY);
    if (v === null) return true;
    return v === "1" || v === "true";
  } catch {
    return true;
  }
}

export function saveAppendRomPref(value: boolean): void {
  try {
    localStorage.setItem(APPEND_ROM_KEY, value ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}
