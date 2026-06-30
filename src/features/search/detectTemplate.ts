/**
 * Provider template auto-detection (W202 / v0.20 "Atlas").
 *
 * Part of "discover & add": instead of hand-crafting a URL template, the user
 * pastes a real search-results URL from a site plus the term they searched for,
 * and this derives the `{query}` template by locating that term in the URL and
 * substituting the placeholder. Pure, framework-free, no network — it only
 * rewrites a string. Handles the common encodings of a search term (raw,
 * percent-encoded spaces, and `+`-encoded spaces) and the case where the URL is
 * already a template.
 */

/** Outcome of a detection attempt. */
export interface DetectResult {
  ok: boolean;
  /** The derived `{query}` template when `ok`, else null. */
  template: string | null;
  /** Human-readable explanation (success note or why it failed). */
  reason: string;
}

/** The encodings a search term might take inside a URL, longest-first so a more
 *  specific encoding wins over a shorter coincidental match. */
function candidates(sample: string): string[] {
  const variants = new Set<string>([
    sample,
    encodeURIComponent(sample), // spaces → %20, punctuation encoded
    sample.replace(/ /g, "+"), // spaces → +
    encodeURIComponent(sample).replace(/%20/g, "+"),
  ]);
  return [...variants]
    .filter((v) => v.length > 0)
    .sort((a, b) => b.length - a.length);
}

/**
 * Derive a `{query}` URL template from a pasted results `url` and the `sample`
 * term that was searched. Returns `ok:false` with a reason when the URL is
 * invalid/non-http, the sample is missing, or the term can't be found in the
 * URL. If the URL already contains `{query}`, it is returned unchanged.
 */
export function detectTemplate(url: string, sample: string): DetectResult {
  const u = url.trim();
  const s = sample.trim();
  if (!u) {
    return { ok: false, template: null, reason: "Paste the search-results URL first." };
  }
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, template: null, reason: "That doesn't look like a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, template: null, reason: "Only http(s) URLs are supported." };
  }
  if (u.includes("{query}")) {
    return { ok: true, template: u, reason: "That URL is already a template." };
  }
  if (!s) {
    return {
      ok: false,
      template: null,
      reason: "Also enter the exact term you searched for, so it can be found in the URL.",
    };
  }
  const lowerUrl = u.toLowerCase();
  for (const cand of candidates(s)) {
    const idx = lowerUrl.indexOf(cand.toLowerCase());
    if (idx >= 0) {
      const template = u.slice(0, idx) + "{query}" + u.slice(idx + cand.length);
      return { ok: true, template, reason: "Detected the search term in the URL." };
    }
  }
  return {
    ok: false,
    template: null,
    reason: `Couldn't find "${s}" in that URL — make sure it's the exact term you searched for.`,
  };
}
