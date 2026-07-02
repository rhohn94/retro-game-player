// build-console-catalog.mjs — generate the bundled per-console title catalog.
//
// Feature: the "By Console" view browses every known title for a console. The
// title lists come from the community-maintained libretro-database datfiles
// (https://github.com/libretro/libretro-database) — these carry game NAMES and
// checksums only (no game content), are freely redistributable, and are the same
// ecosystem this app already uses for cover-art thumbnails. It ships no ROMs.
//
// For each curated system this script:
//   1. fetches the system's clrmamepro datfile from libretro-database,
//   2. parses each `game ( name "..." )` entry,
//   3. normalizes the No-Intro name to a canonical title (strips the trailing
//      (Region)/(Rev)/(Proto)/[BIOS] tag groups), de-duplicates case-insensitively,
//   4. writes a compact `src-tauri/resources/catalog/<system>.json`.
//
// The generated JSON is committed and embedded into the binary at build time
// (see core/console/titles.rs, include_dir!). Re-run with `node
// scripts/build-console-catalog.mjs` to refresh against upstream.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "src-tauri", "resources", "catalog");
const RAW_BASE =
  "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat";

// system key (matches core/cores/system_map.rs SYSTEM_CORES) → datfile.
// `dir` is the libretro-database metadat subfolder; `file` the datfile name.
// neogeo (cartridge MVS/AES) has no No-Intro set; we use the Neo Geo CD redump
// list as the closest browsable title catalog for the platform.
const SYSTEMS = [
  { system: "nes", dir: "no-intro", file: "Nintendo - Nintendo Entertainment System.dat" },
  { system: "snes", dir: "no-intro", file: "Nintendo - Super Nintendo Entertainment System.dat" },
  { system: "n64", dir: "no-intro", file: "Nintendo - Nintendo 64.dat" },
  { system: "atari2600", dir: "no-intro", file: "Atari - 2600.dat" },
  { system: "atari5200", dir: "no-intro", file: "Atari - 5200.dat" },
  { system: "atari7800", dir: "no-intro", file: "Atari - 7800.dat" },
  { system: "intellivision", dir: "no-intro", file: "Mattel - Intellivision.dat" },
  { system: "colecovision", dir: "no-intro", file: "Coleco - ColecoVision.dat" },
  { system: "odyssey2", dir: "no-intro", file: "Magnavox - Odyssey2.dat" },
  { system: "mastersystem", dir: "no-intro", file: "Sega - Master System - Mark III.dat" },
  { system: "genesis", dir: "no-intro", file: "Sega - Mega Drive - Genesis.dat" },
  { system: "pcengine", dir: "no-intro", file: "NEC - PC Engine - TurboGrafx 16.dat" },
  { system: "neogeo", dir: "redump", file: "SNK - Neo Geo CD.dat" },
  { system: "ps1", dir: "redump", file: "Sony - PlayStation.dat" },
  { system: "saturn", dir: "redump", file: "Sega - Saturn.dat" },
  { system: "3do", dir: "redump", file: "The 3DO Company - 3DO.dat" },
  { system: "jaguar", dir: "no-intro", file: "Atari - Jaguar.dat" },
  { system: "dreamcast", dir: "redump", file: "Sega - Dreamcast.dat" },
  { system: "ps2", dir: "redump", file: "Sony - PlayStation 2.dat" },
  { system: "gamecube", dir: "redump", file: "Nintendo - GameCube.dat" },
];

/** Build the raw.githubusercontent URL, encoding each path segment. */
function datUrl({ dir, file }) {
  return `${RAW_BASE}/${encodeURIComponent(dir)}/${encodeURIComponent(file)}`;
}

/**
 * Reduce a No-Intro / Redump name to a canonical display title: drop every
 * parenthesized "(...)" and bracketed "[...]" tag group (region, revision,
 * proto, BIOS, languages, …) and collapse whitespace. Returns "" when nothing
 * meaningful remains (e.g. a pure "[BIOS]" entry).
 */
function canonicalTitle(name) {
  return name
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a clrmamepro datfile into its de-duplicated canonical titles. The format
 * is a flat list of `game (\n\tname "Title"\n\t... )` blocks; the first
 * tab-indented `name "..."` after a `game (` line is the entry's title (the
 * `rom ( name "..." )` lines are not, and start with `rom`).
 */
function parseTitles(text) {
  const lines = text.split(/\r?\n/);
  const seen = new Map(); // lowercased canonical → display canonical (first seen)
  let inGame = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "game (") {
      inGame = true;
      continue;
    }
    if (inGame && line.startsWith('name "')) {
      const m = line.match(/^name "(.*)"$/);
      inGame = false; // the game name is the first name-line in the block
      if (!m) continue;
      const title = canonicalTitle(m[1]);
      if (!title) continue;
      const key = title.toLowerCase();
      if (!seen.has(key)) seen.set(key, title);
    } else if (line === ")") {
      inGame = false;
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "retro-game-player-catalog-build" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function buildOne(entry) {
  const url = datUrl(entry);
  const text = await fetchText(url);
  const titles = parseTitles(text);
  const payload = {
    system: entry.system,
    source: "libretro-database",
    sourceFile: `metadat/${entry.dir}/${entry.file}`,
    count: titles.length,
    titles,
  };
  const outPath = resolve(OUT_DIR, `${entry.system}.json`);
  await writeFile(outPath, JSON.stringify(payload) + "\n", "utf8");
  return { system: entry.system, count: titles.length, bytes: text.length };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const results = [];
  const failures = [];
  // Modest concurrency to be polite to the CDN.
  const queue = [...SYSTEMS];
  const CONCURRENCY = 4;
  async function worker() {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      try {
        const r = await buildOne(entry);
        results.push(r);
        process.stdout.write(
          `  ✓ ${r.system.padEnd(14)} ${String(r.count).padStart(6)} titles\n`,
        );
      } catch (err) {
        failures.push({ system: entry.system, error: String(err) });
        process.stdout.write(`  ✗ ${entry.system.padEnd(14)} ${String(err)}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  results.sort((a, b) => a.system.localeCompare(b.system));
  const total = results.reduce((n, r) => n + r.count, 0);
  process.stdout.write(
    `\nWrote ${results.length}/${SYSTEMS.length} catalogs (${total} distinct titles) to ${OUT_DIR}\n`,
  );
  if (failures.length) {
    process.stdout.write(`Failures: ${JSON.stringify(failures, null, 2)}\n`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
