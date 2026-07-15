/**
 * Local search UX preferences (Phase 2 + Phase 4 query compose).
 * Pure localStorage helpers — no React.
 */

const APPEND_ROM_KEY = "rgp.search.appendRom";
const APPEND_ZIP_KEY = "rgp.search.appendZip";
const EXCLUDE_NOISE_KEY = "rgp.search.excludeNoise";
const QUOTE_TITLE_KEY = "rgp.search.quoteTitle";

function loadBool(key: string, defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultValue;
    return v === "1" || v === "true";
  } catch {
    return defaultValue;
  }
}

function saveBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

/** Default ON: meta-search ranks downloadable hits better with a `rom` token. */
export function loadAppendRomPref(): boolean {
  return loadBool(APPEND_ROM_KEY, true);
}

export function saveAppendRomPref(value: boolean): void {
  saveBool(APPEND_ROM_KEY, value);
}

/** Default OFF: append `zip` for archive-oriented SERP bias (Phase 4). */
export function loadAppendZipPref(): boolean {
  return loadBool(APPEND_ZIP_KEY, false);
}

export function saveAppendZipPref(value: boolean): void {
  saveBool(APPEND_ZIP_KEY, value);
}

/** Default ON: meta hosts get `-emulator -wiki -youtube …` (Phase 4). */
export function loadExcludeNoisePref(): boolean {
  return loadBool(EXCLUDE_NOISE_KEY, true);
}

export function saveExcludeNoisePref(value: boolean): void {
  saveBool(EXCLUDE_NOISE_KEY, value);
}

/** Default ON: multi-word titles quoted on meta hosts (Phase 4). */
export function loadQuoteTitlePref(): boolean {
  return loadBool(QUOTE_TITLE_KEY, true);
}

export function saveQuoteTitlePref(value: boolean): void {
  saveBool(QUOTE_TITLE_KEY, value);
}
