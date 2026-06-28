// Mock Tauri IPC for headless visual inspection (T4 — runtime-verification-design.md).
//
// A Tauri app's `invoke()` calls `window.__TAURI_INTERNALS__.invoke(cmd, args)`,
// which only exists inside the real WKWebView. In a headless browser that global
// is absent, so every screen's data load throws and the UI renders error/empty
// states (e.g. "Could not load games"). That hides the real, populated layout
// from visual inspection.
//
// This module injects a deterministic mock of that global BEFORE the app boots,
// returning fixtures per command so the Library/Cores/Search/Settings screens
// render with realistic content. It is used ONLY by the visual-inspection
// harness (scripts/visual-inspect.mjs); it is never imported by app code and
// never ships in the bundle. Keep fixtures shaped exactly like the IPC DTOs in
// src/ipc/*.ts.

const NOW = 1_700_000_000_000;

/** Fixtures keyed by IPC command name. Values must be JSON-serializable
 *  (injected via JSON.stringify), so single-shape returns only — commands that
 *  vary by argument (e.g. get_game) return one representative record. */
export const MOCK_FIXTURES = {
  ping: "pong (mock-ipc)",

  // --- Library (src/ipc/library.ts) ---
  list_games: [
    { id: 1, path: "/roms/nes/Super Mario Bros. 3.nes", system: "nes", crc32: "0b742b33", md5: null, cleanName: "Super Mario Bros. 3", datMatched: true, coreHint: "mesen", artPath: null, sizeBytes: 393216, addedAt: NOW, year: 1988, developer: "Nintendo R&D4", publisher: "Nintendo", aliases: ["SMB3"] },
    { id: 2, path: "/roms/snes/The Legend of Zelda - A Link to the Past.sfc", system: "snes", crc32: "777aac2f", md5: null, cleanName: "The Legend of Zelda: A Link to the Past", datMatched: true, coreHint: "snes9x", artPath: null, sizeBytes: 1048576, addedAt: NOW, year: 1991, developer: "Nintendo EAD", publisher: "Nintendo", aliases: ["ALttP", "Zelda 3"] },
    { id: 3, path: "/roms/snes/Super Metroid.sfc", system: "snes", crc32: "d63ed5f8", md5: null, cleanName: "Super Metroid", datMatched: true, coreHint: "snes9x", artPath: null, sizeBytes: 3145728, addedAt: NOW, year: 1994, developer: "Nintendo R&D1", publisher: "Nintendo", aliases: ["Metroid 3"] },
    { id: 4, path: "/roms/n64/Super Mario 64.z64", system: "n64", crc32: "635a2bff", md5: null, cleanName: "Super Mario 64", datMatched: true, coreHint: "mupen64plus_next", artPath: null, sizeBytes: 8388608, addedAt: NOW, year: 1996, developer: "Nintendo EAD", publisher: "Nintendo", aliases: ["SM64"] },
    { id: 5, path: "/roms/nes/Metroid.nes", system: "nes", crc32: null, md5: null, cleanName: "Metroid.nes", datMatched: false, coreHint: "fceumm", artPath: null, sizeBytes: 131072, addedAt: NOW, year: null, developer: null, publisher: null, aliases: [] },
  ],
  get_game: { id: 1, path: "/roms/nes/Super Mario Bros. 3.nes", system: "nes", crc32: "0b742b33", md5: null, cleanName: "Super Mario Bros. 3", datMatched: true, coreHint: "mesen", artPath: null, sizeBytes: 393216, addedAt: NOW, year: 1988, developer: "Nintendo R&D4", publisher: "Nintendo", aliases: ["SMB3"] },
  list_content_folders: [
    { id: 1, path: "/Users/you/ROMs", enabled: true, addedAt: NOW },
  ],
  suggest_games_dir: "/Users/you/Games",
  create_games_folder: "/Users/you/Games",

  // --- Cores (src/ipc/cores.ts) ---
  list_available_cores: [
    { id: 1, system: "nes", coreId: "mesen", installedPath: "/cores/mesen_libretro.dylib", version: "1.0", lastModified: NOW, active: true, available: true },
    { id: 2, system: "nes", coreId: "fceumm", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 3, system: "snes", coreId: "snes9x", installedPath: "/cores/snes9x_libretro.dylib", version: "1.62", lastModified: NOW, active: true, available: true },
    { id: 4, system: "snes", coreId: "bsnes", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 5, system: "n64", coreId: "mupen64plus_next", installedPath: null, version: null, lastModified: null, active: false, available: true },
  ],
  list_installed_cores: [
    { id: 1, system: "nes", coreId: "mesen", installedPath: "/cores/mesen_libretro.dylib", version: "1.0", lastModified: NOW, active: true, available: true },
    { id: 3, system: "snes", coreId: "snes9x", installedPath: "/cores/snes9x_libretro.dylib", version: "1.62", lastModified: NOW, active: true, available: true },
  ],

  // --- Search (src/ipc/search.ts) — the built-in providers seeded by migration 003 ---
  list_providers: [
    { id: 1, name: "MobyGames", urlTemplate: "https://www.mobygames.com/search/?q={query}", enabled: true },
    { id: 2, name: "IGDB", urlTemplate: "https://www.igdb.com/search?type=1&q={query}", enabled: true },
    { id: 3, name: "Wikipedia", urlTemplate: "https://en.wikipedia.org/w/index.php?search={query}", enabled: true },
    { id: 4, name: "GameFAQs", urlTemplate: "https://gamefaqs.gamespot.com/search?game={query}", enabled: true },
  ],
  run_search: [],

  // --- Controller (src/ipc/controllers.ts) ---
  list_bindings: [],

  // --- Launch / RetroArch (src/ipc/launch.ts) ---
  locate_retroarch: "/Applications/RetroArch.app/Contents/MacOS/RetroArch",

  // --- Fleet / Familiar / metadata: degrade gracefully ---
  get_fleet_status: { instanceId: "mock-instance", version: "0.2.0", versionDir: "v0.2.0" },
  probe_familiar: { available: false },
  get_cached_art: null,
  fetch_boxart: null,
  get_blurred_hero: null,
};

/** Build the page-init script string that installs the mock IPC global before
 *  any app code runs. Injected via Playwright's addInitScript. `overrides` (an
 *  object keyed by command) is merged over the defaults — e.g. pass
 *  `{ list_games: [], list_content_folders: [] }` to render the empty states. */
export function buildMockIpcInitScript(overrides = {}) {
  const fixtures = { ...MOCK_FIXTURES, ...overrides };
  return `
    (function () {
      var FIX = ${JSON.stringify(fixtures)};
      var internals = window.__TAURI_INTERNALS__ || (window.__TAURI_INTERNALS__ = {});
      internals.invoke = function (cmd) {
        if (Object.prototype.hasOwnProperty.call(FIX, cmd)) return Promise.resolve(FIX[cmd]);
        console.warn("[mock-ipc] no fixture for command: " + cmd);
        return Promise.resolve(null);
      };
      internals.convertFileSrc = function (p) { return p; };
      internals.transformCallback = function () { return 0; };
      window.__HARMONY_MOCK_IPC__ = true;
    })();
  `;
}
