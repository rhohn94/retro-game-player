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
  get_game: { id: 1, path: "/roms/nes/Super Mario Bros. 3.nes", system: "nes", crc32: "0b742b33", md5: null, cleanName: "Super Mario Bros. 3", datMatched: true, coreHint: "mesen", artPath: null, sizeBytes: 393216, addedAt: NOW, year: 1988, developer: "Nintendo R&D4", publisher: "Nintendo", aliases: ["SMB3"], description: "Super Mario Bros. 3 is a 1988 platform game developed and published by Nintendo for the Famicom and NES.", wikipediaUrl: "https://en.wikipedia.org/wiki/Super_Mario_Bros._3" },
  list_content_folders: [
    { id: 1, path: "/Users/you/ROMs", enabled: true, addedAt: NOW },
  ],
  suggest_games_dir: "/Users/you/Games",
  create_games_folder: "/Users/you/Games",

  // --- Cores (src/ipc/cores.ts) — mirrors the curated catalog in system_map.rs ---
  list_available_cores: [
    { id: 1, system: "nes", coreId: "mesen", installedPath: "/cores/mesen_libretro.dylib", version: "1.0", lastModified: NOW, active: true, available: true },
    { id: 2, system: "nes", coreId: "fceumm", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 6, system: "nes", coreId: "nestopia", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 7, system: "nes", coreId: "quicknes", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 3, system: "snes", coreId: "snes9x", installedPath: "/cores/snes9x_libretro.dylib", version: "1.62", lastModified: NOW, active: true, available: true },
    { id: 4, system: "snes", coreId: "bsnes", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 8, system: "snes", coreId: "snes9x2010", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 5, system: "n64", coreId: "mupen64plus_next", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 9, system: "n64", coreId: "parallel_n64", installedPath: null, version: null, lastModified: null, active: false, available: true },
    // Gen 2–6 home consoles (v0.10 broadened catalog) — a representative slice.
    { id: 10, system: "atari2600", coreId: "stella", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 11, system: "mastersystem", coreId: "genesis_plus_gx", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 12, system: "genesis", coreId: "genesis_plus_gx", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 13, system: "pcengine", coreId: "mednafen_pce", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 14, system: "neogeo", coreId: "fbneo", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 15, system: "ps1", coreId: "pcsx_rearmed", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 16, system: "saturn", coreId: "mednafen_saturn", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 17, system: "dreamcast", coreId: "flycast", installedPath: null, version: null, lastModified: null, active: false, available: true },
    { id: 18, system: "gamecube", coreId: "dolphin", installedPath: null, version: null, lastModified: null, active: false, available: true },
  ],
  list_installed_cores: [
    { id: 1, system: "nes", coreId: "mesen", installedPath: "/cores/mesen_libretro.dylib", version: "1.0", lastModified: NOW, active: true, available: true },
    { id: 3, system: "snes", coreId: "snes9x", installedPath: "/cores/snes9x_libretro.dylib", version: "1.62", lastModified: NOW, active: true, available: true },
  ],

  // --- Search (src/ipc/search.ts) — the built-in providers seeded by migration 003 ---
  list_providers: [
    { id: 1, name: "MobyGames", urlTemplate: "https://www.mobygames.com/search/?q={query}", enabled: true, kind: "reference", directDownload: false, composeFilters: false },
    { id: 2, name: "IGDB", urlTemplate: "https://www.igdb.com/search?type=1&q={query}", enabled: true, kind: "reference", directDownload: false, composeFilters: false },
    { id: 3, name: "Wikipedia", urlTemplate: "https://en.wikipedia.org/w/index.php?search={query}", enabled: true, kind: "reference", directDownload: false, composeFilters: false },
    { id: 4, name: "GameFAQs", urlTemplate: "https://gamefaqs.gamespot.com/search?game={query}", enabled: true, kind: "reference", directDownload: false, composeFilters: false },
    // Download-oriented, links-only legal sources (v0.11 migration 004).
    { id: 5, name: "Internet Archive", urlTemplate: "https://archive.org/search?query={query}", enabled: true, kind: "download", directDownload: false, composeFilters: false },
    { id: 6, name: "itch.io", urlTemplate: "https://itch.io/search?q={query}", enabled: true, kind: "download", directDownload: false, composeFilters: false },
    // v0.19 "Reach" — vetted legal, server-rendered providers (migration 009).
    { id: 7, name: "Steam", urlTemplate: "https://store.steampowered.com/search/?term={query}", enabled: true, kind: "download", directDownload: false, composeFilters: false },
    { id: 8, name: "PDRoms", urlTemplate: "https://www.pdroms.de/?s={query}", enabled: true, kind: "download", directDownload: false, composeFilters: false },
    { id: 9, name: "Demozoo", urlTemplate: "https://demozoo.org/productions/?q={query}", enabled: true, kind: "download", directDownload: false, composeFilters: false },
    { id: 10, name: "Pouet", urlTemplate: "https://www.pouet.net/prodlist.php?prod={query}", enabled: true, kind: "download", directDownload: false, composeFilters: false },
    { id: 11, name: "Lemon Amiga", urlTemplate: "https://www.lemonamiga.com/games/list.php?list_title={query}", enabled: true, kind: "reference", directDownload: false, composeFilters: false },
    { id: 12, name: "Zophar's Domain", urlTemplate: "https://www.zophar.net/music/search?search={query}", enabled: true, kind: "download", directDownload: false, composeFilters: false },
    { id: 13, name: "ROMhacking.net", urlTemplate: "https://www.romhacking.net/hacks/?title={query}", enabled: true, kind: "download", directDownload: false, composeFilters: false },
  ],
  // v0.16 preview shape: one ProviderResults group per provider, with scraped
  // items, the searchUrl fallback, and an optional per-provider error.
  run_search: [
    {
      providerId: 5,
      providerName: "Internet Archive",
      searchUrl: "https://archive.org/search?query=mario",
      directDownload: false,
      items: [
        { title: "Super Mario Bros. (USA)", url: "https://archive.org/details/smb-usa" },
        { title: "Super Mario World (World)", url: "https://archive.org/details/smw-world" },
        { title: "Super Mario Bros. 3 (USA) (Rev A) [!].zip", url: "https://archive.org/details/smb3-usa-reva" },
        { title: "Super Mario Bros. 2 (Japan) [b]", url: "https://archive.org/details/smb2-jp" },
        // v0.18: an unrelated title (no "mario" terms) — ranked last, badged as
        // no match, and removed by "Hide unlikely matches".
        { title: "Donkey Kong Country (USA)", url: "https://archive.org/details/dkc-usa" },
      ],
      error: null,
    },
    {
      providerId: 8,
      providerName: "PDRoms",
      searchUrl: "https://www.pdroms.de/?s=mario",
      directDownload: false,
      items: [
        // Overlaps Internet Archive's "Super Mario Bros. 3 …" → same normalized
        // key, so the game-first view merges them into one "2 providers" row.
        { title: "Super Mario Bros 3 (Europe)", url: "https://www.pdroms.de/smb3-eur" },
        { title: "Mario Builder (Homebrew)", url: "https://www.pdroms.de/homebrew-mario" },
      ],
      error: null,
    },
    {
      providerId: 6,
      providerName: "itch.io",
      searchUrl: "https://itch.io/search?q=mario",
      directDownload: false,
      items: [],
      error: "network error: provider returned status 503",
    },
  ],

  // v0.20 provider discovery. list_provider_catalog returns curated entries (a
  // representative slice); validate_provider returns one sample "good" result.
  list_provider_catalog: [
    { name: "itch.io", urlTemplate: "https://itch.io/search?q={query}", kind: "download", media: "Indie & homebrew", description: "The largest independent game storefront.", jsRendered: true, added: true },
    { name: "GameJolt", urlTemplate: "https://gamejolt.com/search?q={query}", kind: "download", media: "Indie & homebrew", description: "Indie community and storefront with many free titles.", jsRendered: true, added: false },
    { name: "PDRoms", urlTemplate: "https://www.pdroms.de/?s={query}", kind: "download", media: "Homebrew & public-domain", description: "Curated homebrew and public-domain games.", jsRendered: false, added: true },
    { name: "Demozoo", urlTemplate: "https://demozoo.org/productions/?q={query}", kind: "download", media: "Demoscene", description: "Demoscene productions database.", jsRendered: false, added: true },
    { name: "Steam", urlTemplate: "https://store.steampowered.com/search/?term={query}", kind: "download", media: "Storefront", description: "Valve's licensed storefront.", jsRendered: false, added: true },
    { name: "GOG", urlTemplate: "https://www.gog.com/en/games?query={query}", kind: "download", media: "Storefront", description: "DRM-free storefront strong on retro PC games.", jsRendered: true, added: false },
    { name: "MobyGames", urlTemplate: "https://www.mobygames.com/search/?q={query}", kind: "reference", media: "Reference", description: "Cross-platform game metadata database.", jsRendered: false, added: true },
  ],
  validate_provider: {
    searchUrl: "https://example.com/search?q=mario",
    linkCount: 12,
    sampleTitles: ["Super Mario Bros. (USA)", "Super Mario World", "Mario Kart 64"],
    likelyJsRendered: false,
    error: null,
  },

  // v0.19 liveness probe (src/ipc/search.ts probeLinks). The mock ignores the
  // url args and returns a representative mix so the status dots render.
  probe_links: [
    { url: "https://archive.org/details/smb-usa", state: "alive" },
    { url: "https://archive.org/details/smw-world", state: "alive" },
    { url: "https://archive.org/details/smb3-usa-reva", state: "alive" },
    { url: "https://archive.org/details/smb2-jp", state: "dead" },
    { url: "https://archive.org/details/dkc-usa", state: "unknown" },
    { url: "https://www.pdroms.de/smb3-eur", state: "alive" },
    { url: "https://www.pdroms.de/homebrew-mario", state: "unknown" },
  ],

  // --- Controller (src/ipc/controllers.ts) ---
  list_bindings: [],

  // --- Launch / RetroArch (src/ipc/launch.ts) ---
  locate_retroarch: "/Applications/RetroArch.app/Contents/MacOS/RetroArch",

  // --- Console catalog (src/ipc/console.ts, v0.12) ---
  list_consoles: [
    { key: "nes", name: "Nintendo Entertainment System", manufacturer: "Nintendo", abbreviation: "NES", generation: 3, year: 1983, description: null, wikipediaUrl: null, imagePath: null, ownedCount: 2, catalogCount: 4081 },
    { key: "mastersystem", name: "Sega Master System", manufacturer: "Sega", abbreviation: "SMS", generation: 3, year: 1985, description: null, wikipediaUrl: null, imagePath: null, ownedCount: 0, catalogCount: 770 },
    { key: "snes", name: "Super Nintendo Entertainment System", manufacturer: "Nintendo", abbreviation: "SNES", generation: 4, year: 1990, description: null, wikipediaUrl: null, imagePath: null, ownedCount: 2, catalogCount: 2418 },
    { key: "genesis", name: "Sega Genesis / Mega Drive", manufacturer: "Sega", abbreviation: "MD", generation: 4, year: 1988, description: null, wikipediaUrl: null, imagePath: null, ownedCount: 0, catalogCount: 1804 },
    { key: "n64", name: "Nintendo 64", manufacturer: "Nintendo", abbreviation: "N64", generation: 5, year: 1996, description: null, wikipediaUrl: null, imagePath: null, ownedCount: 1, catalogCount: 601 },
    { key: "ps1", name: "Sony PlayStation", manufacturer: "Sony", abbreviation: "PS1", generation: 5, year: 1994, description: null, wikipediaUrl: null, imagePath: null, ownedCount: 0, catalogCount: 6375 },
  ],
  get_console: {
    key: "nes", name: "Nintendo Entertainment System", manufacturer: "Nintendo", abbreviation: "NES", generation: 3, year: 1983,
    cpu: "Ricoh 2A03 @ 1.79 MHz", gpu: "Ricoh 2C02 PPU", ram: "2 KB",
    description: "The Nintendo Entertainment System is an 8-bit home video game console developed and marketed by Nintendo. It was first released in Japan in 1983 as the Family Computer.",
    wikipediaUrl: "https://en.wikipedia.org/wiki/Nintendo_Entertainment_System", imagePath: null, ownedCount: 2, catalogCount: 4081,
  },
  list_catalog_titles: {
    system: "nes", total: 3, offset: 0,
    items: [
      { title: "Super Mario Bros.", owned: true },
      { title: "Metroid", owned: false },
      { title: "Mega Man 2", owned: false },
    ],
  },

  // --- Fleet / Familiar / metadata: degrade gracefully ---
  get_fleet_status: { instanceId: "mock-instance", version: "0.2.0", versionDir: "v0.2.0" },
  probe_familiar: { available: false },
  get_cached_art: null,
  fetch_boxart: null,
  enrich_game_metadata: { id: 1, path: "/roms/nes/Super Mario Bros. 3.nes", system: "nes", crc32: "0b742b33", md5: null, cleanName: "Super Mario Bros. 3", datMatched: true, coreHint: "mesen", artPath: null, sizeBytes: 393216, addedAt: NOW, year: 1988, developer: "Nintendo R&D4", publisher: "Nintendo", aliases: ["SMB3"], description: "A platform game.", wikipediaUrl: "https://en.wikipedia.org/wiki/Super_Mario_Bros._3" },
  import_games: [],
  // v0.15 in-page play — empty origin means "play server unavailable", so the
  // headless/mocked detail route renders the native Play button (no iframe to a
  // loopback origin that doesn't exist under the smoke harness).
  get_play_origin: "",
  get_blurred_hero: null,
  // v0.23 save persistence (W230/W232) — a fresh install has no saves.
  list_game_saves: { hasSram: false, slots: [] },
  save_native_state: null,
  load_native_state: null,
  set_native_paused: null,
  set_native_volume: null,
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
