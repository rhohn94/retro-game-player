/**
 * Console search UX + ranking aliases.
 *
 * The dropdown used to show only the short tag ("MD"), which hid dual-region
 * names (Genesis / Mega Drive). Ranking used name+abbr+key only, so dump tags
 * like "SMD" or "GEN" never boosted. This module:
 * - Builds clearer option labels (e.g. "Genesis / Mega Drive (MD)")
 * - Supplies a rich console token bag for client-side ranking / Match boosts
 *
 * Outbound provider query expansion (OR groups for meta) lives in Rust
 * `console_aliases.rs`; the frontend sends the console **key** when possible
 * so the backend can resolve aliases authoritatively.
 */

import type { ConsoleInfo } from "../../ipc/console";

/** Extra ranking aliases by system key (mirrors the high-value Rust table). */
const RANK_ALIASES: Record<string, readonly string[]> = {
  atari2600: ["atari 2600", "2600", "a2600", "vcs"],
  odyssey2: ["odyssey 2", "odyssey2", "videopac"],
  intellivision: ["intellivision", "intv"],
  atari5200: ["atari 5200", "5200"],
  colecovision: ["colecovision", "coleco vision"],
  nes: ["nes", "famicom", "nintendo entertainment system", "fc"],
  mastersystem: ["master system", "mastersystem", "sms", "mark iii"],
  atari7800: ["atari 7800", "7800"],
  pcengine: [
    "pc engine",
    "turbografx",
    "turbografx-16",
    "turbografx 16",
    "tg16",
    "pce",
    "hucard",
  ],
  genesis: [
    "genesis",
    "mega drive",
    "megadrive",
    "md",
    "smd",
    "gen",
    "sega genesis",
    "sega mega drive",
  ],
  gb: ["game boy", "gameboy", "gb", "dmg"],
  snes: ["snes", "super nintendo", "super famicom", "sfc", "super nes"],
  neogeo: ["neo geo", "neogeo", "aes", "mvs"],
  "3do": ["3do"],
  jaguar: ["atari jaguar", "jaguar"],
  ps1: ["ps1", "psx", "playstation", "playstation 1", "psone"],
  saturn: ["sega saturn", "saturn"],
  n64: ["n64", "nintendo 64", "ultra 64"],
  gbc: ["game boy color", "gameboy color", "gbc", "cgb"],
  dreamcast: ["dreamcast", "dc", "sega dreamcast"],
  ps2: ["ps2", "playstation 2", "playstation2"],
  gamecube: ["gamecube", "game cube", "gcn", "ngc"],
  gba: ["game boy advance", "gameboy advance", "gba", "agb"],
  wii: ["wii", "nintendo wii"],
};

/**
 * Dual-region / multi-brand short labels for the dropdown when the full
 * catalog name is long or slash-joined.
 */
const DROPDOWN_SHORT: Record<string, string> = {
  genesis: "Genesis / Mega Drive",
  pcengine: "PC Engine / TG-16",
  nes: "NES / Famicom",
  snes: "SNES / Super Famicom",
  mastersystem: "Master System",
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  n64: "Nintendo 64",
  gamecube: "GameCube",
  dreamcast: "Dreamcast",
  neogeo: "Neo Geo",
  saturn: "Saturn",
  jaguar: "Jaguar",
  wii: "Wii",
};

/**
 * Label for one `<option>` in the Search console select.
 * Prefer a clear dual-region short name + abbreviation over bare "MD".
 */
export function consoleDropdownLabel(c: ConsoleInfo): string {
  const short = DROPDOWN_SHORT[c.key];
  if (short) {
    // Avoid "NES / Famicom (NES)" duplication when short already embeds abbr.
    if (short.toLowerCase().includes(c.abbreviation.toLowerCase())) {
      return short;
    }
    return `${short} (${c.abbreviation})`;
  }
  // Fallback: full name when short, else "Name (ABBR)".
  if (c.name.length <= 28) {
    if (c.abbreviation && !c.name.toLowerCase().includes(c.abbreviation.toLowerCase())) {
      return `${c.name} (${c.abbreviation})`;
    }
    return c.name;
  }
  return `${c.abbreviation || c.key} — ${c.name}`;
}

/**
 * Space-joined ranking tokens for {@link RankQuery.console}: catalog name,
 * abbreviation, key, and curated aliases (genesis, mega drive, md, smd, …).
 */
export function consoleRankTokenBag(c: ConsoleInfo): string {
  const parts: string[] = [c.name, c.abbreviation, c.key];
  const extra = RANK_ALIASES[c.key];
  if (extra) parts.push(...extra);
  // Dedup case-insensitively while keeping order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(" ");
}

/**
 * Value sent to `run_search` as the console compose filter.
 * Prefer the canonical system key so Rust `console_aliases` can expand it.
 */
export function consoleComposeValue(c: ConsoleInfo): string {
  return c.key;
}
