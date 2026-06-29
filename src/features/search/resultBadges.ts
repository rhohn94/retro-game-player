/**
 * Title-parsed result badges (W174 / v0.17 "Sift").
 *
 * Pure regex parsing of the scraped anchor text into compact, scannable chips —
 * region, revision, dump-quality (GoodTools markers), and file type. Modelled on
 * the *arr stack's quality badges, but derived entirely from the title string we
 * already have (no extra metadata, no network). Returns an empty list when the
 * title carries no recognizable tokens, so most rows render no chips.
 */

/** A parsed badge. `tone` drives chip colour; `kind` groups like badges. */
export interface Badge {
  kind: "region" | "revision" | "quality" | "filetype";
  label: string;
  tone: "good" | "bad" | "neutral";
}

// Region tokens commonly seen in No-Intro / Redump style names. Mapped to a
// short normalized label. Matched case-insensitively as whole words.
const REGION_TOKENS: Record<string, string> = {
  usa: "USA",
  us: "USA",
  europe: "EUR",
  eur: "EUR",
  japan: "JPN",
  jpn: "JPN",
  jp: "JPN",
  world: "World",
  uk: "UK",
  germany: "GER",
  france: "FRA",
  spain: "SPA",
  italy: "ITA",
  australia: "AUS",
  korea: "KOR",
  china: "CHN",
  brazil: "BRA",
  canada: "CAN",
};

// GoodTools dump-quality markers: code → [label, tone].
const QUALITY_MARKERS: Record<string, { label: string; tone: Badge["tone"] }> = {
  "!": { label: "Verified", tone: "good" },
  b: { label: "Bad dump", tone: "bad" },
  o: { label: "Overdump", tone: "bad" },
  h: { label: "Hack", tone: "neutral" },
  t: { label: "Trained", tone: "neutral" },
  a: { label: "Alt", tone: "neutral" },
  p: { label: "Pirate", tone: "bad" },
  f: { label: "Fixed", tone: "neutral" },
};

// Recognized content file extensions (ROM/disc/archive). Lower-cased.
const FILE_TYPES = new Set([
  "zip", "7z", "rar", "gz", "iso", "bin", "cue", "chd", "rom",
  "nes", "sfc", "smc", "gb", "gbc", "gba", "n64", "z64", "v64",
  "md", "gen", "sms", "gg", "pce", "ngp", "ws", "wsc", "chd",
]);

/** Push a badge only if an identical (kind+label) one is not already present. */
function pushUnique(out: Badge[], badge: Badge): void {
  if (!out.some((b) => b.kind === badge.kind && b.label === badge.label)) {
    out.push(badge);
  }
}

/** Parse all badges from a scraped title, in display order
 *  (region → revision → quality → filetype). */
export function parseBadges(title: string): Badge[] {
  const out: Badge[] = [];

  // Region — scan whole-word tokens against the known set.
  for (const word of title.toLowerCase().match(/[a-z]+/g) ?? []) {
    const label = REGION_TOKENS[word];
    if (label) pushUnique(out, { kind: "region", label, tone: "neutral" });
  }

  // Revision — "Rev A", "Rev 1", or a "v1.1" style version.
  const rev = title.match(/\bRev\s*([0-9A-Za-z])\b/);
  if (rev) {
    pushUnique(out, {
      kind: "revision",
      label: `Rev ${rev[1].toUpperCase()}`,
      tone: "neutral",
    });
  }
  const ver = title.match(/\bv(\d+(?:\.\d+)+)\b/);
  if (ver) {
    pushUnique(out, { kind: "revision", label: `v${ver[1]}`, tone: "neutral" });
  }

  // Dump-quality — GoodTools markers in square brackets, e.g. [!] [b] [o].
  for (const m of title.matchAll(/\[([!bohtapf])\]/g)) {
    const marker = QUALITY_MARKERS[m[1]];
    if (marker) {
      pushUnique(out, {
        kind: "quality",
        label: marker.label,
        tone: marker.tone,
      });
    }
  }

  // File type — extension on the title (e.g. "... (USA).zip").
  const ext = title.toLowerCase().match(/\.([a-z0-9]{1,4})(?:\s|$|\))/);
  if (ext && FILE_TYPES.has(ext[1])) {
    pushUnique(out, {
      kind: "filetype",
      label: ext[1].toUpperCase(),
      tone: "neutral",
    });
  }

  return out;
}
