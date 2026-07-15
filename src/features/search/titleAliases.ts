/**
 * Phase 4 title aliases for client-side ranking / Match badges.
 * When the user searches a short code (or a result uses an alternate name),
 * expand to the fuller title so content-term matching still fires.
 */

/** Lowercase short form → fuller title used for ranking terms. */
const ALIASES: Record<string, string> = {
  smb: "super mario bros",
  smb1: "super mario bros",
  smb2: "super mario bros 2",
  smb3: "super mario bros 3",
  smw: "super mario world",
  sm64: "super mario 64",
  oot: "legend of zelda ocarina of time",
  ocarina: "legend of zelda ocarina of time",
  mm: "legend of zelda majoras mask",
  majora: "legend of zelda majoras mask",
  alttp: "legend of zelda a link to the past",
  lttp: "legend of zelda a link to the past",
  botw: "legend of zelda breath of the wild",
  totk: "legend of zelda tears of the kingdom",
  ssbm: "super smash bros melee",
  melee: "super smash bros melee",
  "s&k": "sonic and knuckles",
  s3k: "sonic 3 and knuckles",
  mmx: "mega man x",
  sf2: "street fighter ii",
  ff7: "final fantasy vii",
  ffvii: "final fantasy vii",
  ff6: "final fantasy vi",
  ffvi: "final fantasy vi",
  sotn: "castlevania symphony of the night",
  chrono: "chrono trigger",
  sm: "super metroid",
};

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Expand a whole query if it is a known short alias; otherwise return as-is. */
export function expandTitleAlias(query: string): string {
  const key = normalizeKey(query);
  return ALIASES[key] ?? query.trim();
}

/**
 * Content terms for ranking: use expanded alias terms when the query is a
 * short code, unioned with the original tokens so either form matches.
 */
export function rankingNameForQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  const expanded = expandTitleAlias(trimmed);
  if (expanded === trimmed) return trimmed;
  // Union original + expanded so "oot" still matches titles containing "oot"
  // and full "ocarina of time" titles match too.
  return `${trimmed} ${expanded}`;
}

/** Hosts that reliably host downloadable dumps — small ranking boost. */
const GOOD_FILE_HOSTS = [
  "archive.org",
  "myrient.erista.me",
  "cdn.discordapp.com",
  "ia801",
  "ia902",
  "ia903",
  "ia804",
];

export function isKnownFileHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return GOOD_FILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h));
  } catch {
    return false;
  }
}
