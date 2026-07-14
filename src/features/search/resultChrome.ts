/**
 * Site-chrome / file-like heuristics for scraped search previews (search-result
 * quality P0). Pure, framework-free — used by ranking and the visibility
 * pipeline so nav noise never looks like a game hit.
 */

import type { Rankable } from "./resultRanking";

/** Query tokens that must not gate match strength (too common in English titles
 *  and in nav copy). Kept lowercase. */
export const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "for",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "vs",
  "versus",
]);

/** Lowercase alphanumeric tokens of `s`. */
export function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Content-bearing query terms (stopwords removed). */
export function contentTerms(queryName: string): string[] {
  return tokens(queryName).filter((t) => !QUERY_STOPWORDS.has(t) && t.length > 1);
}

/** ROM / disc / archive extensions we treat as “looks like a file”. */
const FILE_EXT = new Set([
  "zip",
  "7z",
  "rar",
  "gz",
  "iso",
  "bin",
  "cue",
  "chd",
  "rom",
  "nes",
  "sfc",
  "smc",
  "gb",
  "gbc",
  "gba",
  "n64",
  "z64",
  "v64",
  "md",
  "gen",
  "smd",
  "sms",
  "gg",
  "pce",
  "ngp",
  "ws",
  "wsc",
  "nds",
  "3ds",
  "wbfs",
  "rvz",
  "wad",
]);

/** True when title or URL path ends with a known content extension. */
export function isFileLike(item: Rankable): boolean {
  const hay = `${item.title} ${pathOnly(item.url)}`.toLowerCase();
  // extension at end of a path segment or title token
  const m = hay.match(/\.([a-z0-9]{1,5})(?:\?|#|$|[\s)\]"'])/i);
  if (m && FILE_EXT.has(m[1].toLowerCase())) return true;
  // bare "something.zip" as whole title
  const t = item.title.trim().toLowerCase();
  const m2 = t.match(/\.([a-z0-9]{1,5})$/);
  return !!(m2 && FILE_EXT.has(m2[1]));
}

/** URL without query/hash so ranking never treats ?q=sonic as title evidence. */
export function pathOnly(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

/** Exact titles (case-insensitive, trimmed) that are almost always chrome. */
const EXACT_CHROME = new Set(
  [
    "home",
    "homepage",
    "frontpage",
    "front page",
    "index",
    "roms",
    "rom",
    "games",
    "games",
    "emulators",
    "emulator",
    "tags",
    "tag",
    "search",
    "login",
    "log in",
    "sign in",
    "sign up",
    "register",
    "logout",
    "contact",
    "about",
    "about us",
    "privacy",
    "privacy policy",
    "terms",
    "terms of service",
    "faq",
    "help",
    "support",
    "forum",
    "forums",
    "blog",
    "news",
    "cart",
    "wishlist",
    "donate",
    "discord",
    "twitter",
    "facebook",
    "reddit",
    "youtube",
    "menu",
    "skip to content",
    "skip to main content",
    "sticky header",
    "view all",
    "view all roms",
    "view all roms »",
    "more",
    "next",
    "previous",
    "prev",
    "top",
    "download",
    "uploads",
    "random",
    "sitemap",
  ].map((s) => s.toLowerCase()),
);

/** Console / platform index labels scraped as nav (not a specific title). */
const PLATFORM_INDEX = new Set(
  [
    "nes",
    "snes",
    "n64",
    "gamecube",
    "wii",
    "wii u",
    "switch",
    "gameboy",
    "game boy",
    "gameboy color",
    "game boy color",
    "gameboy advance",
    "game boy advance",
    "gba",
    "gbc",
    "nds",
    "nintendo ds",
    "3ds",
    "playstation",
    "playstation 2",
    "playstation 3",
    "ps1",
    "ps2",
    "ps3",
    "ps4",
    "ps5",
    "psp",
    "playstation portable",
    "genesis",
    "mega drive",
    "master system",
    "dreamcast",
    "saturn",
    "xbox",
    "xbox 360",
    "pc",
    "mame",
    "arcade",
    "super nintendo",
    "nintendo",
    "sega genesis",
    "nes roms",
    "snes roms",
    "n64 roms",
    "gba roms",
    "nds roms",
    "gb roms",
    "ps1 roms",
    "ps2 roms",
    "psp roms",
    "wii roms",
    "gamecube roms",
    "roms/games/isos",
  ].map((s) => s.toLowerCase()),
);

/**
 * True when this row is almost certainly site chrome rather than a game hit.
 * Rows that already contain a content query term in the **title** are kept
 * (e.g. "Homebrew Sonic") so we never drop real results that happen to share
 * a word with the denylist.
 */
export function isSiteChrome(item: Rankable, queryName = ""): boolean {
  const title = item.title.trim();
  if (!title) return true;
  const lower = title.toLowerCase().replace(/\s+/g, " ").trim();

  // If the title carries any content query term, treat as a real candidate.
  const content = contentTerms(queryName);
  if (content.length > 0) {
    const titleTokens = new Set(tokens(title));
    const titleHay = lower;
    if (content.some((t) => titleTokens.has(t) || titleHay.includes(t))) {
      return false;
    }
  }

  if (EXACT_CHROME.has(lower)) return true;
  if (PLATFORM_INDEX.has(lower)) return true;

  // Bare 2-letter language / locale codes (En, Fr, Es, …) common in scrapes.
  if (/^[a-z]{2}$/i.test(title.trim())) return true;
  if (/^[a-z]{2}\s*\/\s*[a-z]{2}/i.test(title.trim())) return true;

  // "Nintendo DS ROMs", "View All Roms »", trailing chevrons
  if (/^view all\b/i.test(lower)) return true;
  if (/^roms?\b/i.test(lower) && lower.length < 24) return true;
  if (/\broms?\s*$/i.test(lower) && content.length > 0) {
    // "N64 ROMs" without query terms already handled; with only platform words
    const withoutRoms = lower.replace(/\broms?\b/g, "").trim();
    if (PLATFORM_INDEX.has(withoutRoms) || PLATFORM_INDEX.has(lower)) return true;
  }

  return false;
}
