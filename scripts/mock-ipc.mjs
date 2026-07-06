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
const NOW_SEC = NOW / 1000;
const DAY_SEC = 86_400;

/** A tiny deterministic PNG (8×12 gradient) as a data: URI, used as the mock's
 *  cached cover-art path. `convertFileSrc` in the mock is identity, so the art
 *  resolvers (`useGameArt` → `heroArtFor` → `artUrl`) paint this straight into
 *  `<img src>` / `background-image` with no network — so the TV home renders an
 *  ART-FORWARD library (cover tiles + hero backdrop) and the takeover's
 *  expanding cover layer has real art to animate, all headless + deterministic
 *  (v0.26 W26A). A data URI (not a filesystem path) is the only art source that
 *  actually paints in the headless harness. Boxart-only so every surface's
 *  fallback chain (tile: boxart→…, hero: snap→title→boxart) resolves to it. */
const MOCK_COVER_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAMCAYAAABfnvydAAAAuElEQVR4nA3Doa2CUQyA0U7CBm8DNmADNsCgK28wVCCq/lTWkDSoCjQGg0azS993kiM7/c1u0egMJov9G/nT7/wtGp3BZLG/I3v9zH7R6Awmi/0ZOehrDotGZzBZ7NfIUZ9zXDQ6g8liP0dO+pjTotEZTBb7MaKao4tGZzBZ7By56jbXRaMzmCz2NrLpbbZFozOYLPZt5K6XuS8ancFksS8jT9V5LhqdwWSxdeSt53kvGp3BZLHP8w/4S/8xaYkmPQAAAABJRU5ErkJggg==";

/** The mock library, pulled into a named const so the play-stats slices
 *  (list_recently_played / list_favorites) return the SAME records the library
 *  does — the TV home renders real-looking, self-consistent shelves headlessly
 *  (v0.26 W261). Varied lastPlayedAt / favorite / system so the home shows a
 *  populated Continue-playing rail, a Favorites rail, per-system rails ordered
 *  by recency, and a mix of art-less tiles (name-caption fallback). */
const MOCK_GAMES = [
  { id: 1, path: "/roms/nes/Super Mario Bros. 3.nes", system: "nes", crc32: "0b742b33", md5: null, cleanName: "Super Mario Bros. 3", datMatched: true, coreHint: "mesen", artPath: null, sizeBytes: 393216, addedAt: NOW, year: 1988, developer: "Nintendo R&D4", publisher: "Nintendo", aliases: ["SMB3"], favorite: true, lastPlayedAt: NOW_SEC, playCount: 5, totalPlayTimeMs: 3_600_000 },
  { id: 2, path: "/roms/snes/The Legend of Zelda - A Link to the Past.sfc", system: "snes", crc32: "777aac2f", md5: null, cleanName: "The Legend of Zelda: A Link to the Past", datMatched: true, coreHint: "snes9x", artPath: null, sizeBytes: 1048576, addedAt: NOW, year: 1991, developer: "Nintendo EAD", publisher: "Nintendo", aliases: ["ALttP", "Zelda 3"], favorite: true, lastPlayedAt: NOW_SEC - DAY_SEC, playCount: 3, totalPlayTimeMs: 7_200_000 },
  { id: 3, path: "/roms/snes/Super Metroid.sfc", system: "snes", crc32: "d63ed5f8", md5: null, cleanName: "Super Metroid", datMatched: true, coreHint: "snes9x", artPath: null, sizeBytes: 3145728, addedAt: NOW, year: 1994, developer: "Nintendo R&D1", publisher: "Nintendo", aliases: ["Metroid 3"], favorite: false, lastPlayedAt: NOW_SEC - 3 * DAY_SEC, playCount: 1, totalPlayTimeMs: 1_800_000 },
  { id: 4, path: "/roms/n64/Super Mario 64.z64", system: "n64", crc32: "635a2bff", md5: null, cleanName: "Super Mario 64", datMatched: true, coreHint: "mupen64plus_next", artPath: null, sizeBytes: 8388608, addedAt: NOW, year: 1996, developer: "Nintendo EAD", publisher: "Nintendo", aliases: ["SM64"], favorite: true, lastPlayedAt: NOW_SEC - 12 * DAY_SEC, playCount: 8, totalPlayTimeMs: 18_000_000 },
  { id: 5, path: "/roms/nes/Metroid.nes", system: "nes", crc32: null, md5: null, cleanName: "Metroid.nes", datMatched: false, coreHint: "fceumm", artPath: null, sizeBytes: 131072, addedAt: NOW, year: null, developer: null, publisher: null, aliases: [], favorite: false, lastPlayedAt: null, playCount: 0, totalPlayTimeMs: 0 },
  { id: 6, path: "/roms/genesis/Sonic the Hedgehog 2.md", system: "genesis", crc32: "7b905516", md5: null, cleanName: "Sonic the Hedgehog 2", datMatched: true, coreHint: "genesis_plus_gx", artPath: null, sizeBytes: 1048576, addedAt: NOW, year: 1992, developer: "Sega Technical Institute", publisher: "Sega", aliases: ["Sonic 2"], favorite: false, lastPlayedAt: NOW_SEC - 2 * DAY_SEC, playCount: 2, totalPlayTimeMs: 5_400_000 },
];

/** Fixtures keyed by IPC command name. Values must be JSON-serializable
 *  (injected via JSON.stringify), so single-shape returns only — commands that
 *  vary by argument (e.g. get_game) return one representative record. */
export const MOCK_FIXTURES = {
  ping: "pong (mock-ipc)",

  // --- Library (src/ipc/library.ts) ---
  list_games: MOCK_GAMES,
  get_game: { id: 1, path: "/roms/nes/Super Mario Bros. 3.nes", system: "nes", crc32: "0b742b33", md5: null, cleanName: "Super Mario Bros. 3", datMatched: true, coreHint: "mesen", artPath: null, sizeBytes: 393216, addedAt: NOW, year: 1988, developer: "Nintendo R&D4", publisher: "Nintendo", aliases: ["SMB3"], description: "Super Mario Bros. 3 is a 1988 platform game developed and published by Nintendo for the Famicom and NES.", wikipediaUrl: "https://en.wikipedia.org/wiki/Super_Mario_Bros._3", favorite: true, lastPlayedAt: NOW / 1000, playCount: 5, totalPlayTimeMs: 3_600_000 },
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

  // --- Core options (src/ipc/core-options.ts, v0.29 W282) — a representative
  // declared option list for the native-hosted NES core, one of each control
  // archetype (bool / range / enum) so CoreOptionsPane renders every row kind
  // headlessly.
  list_core_options: [
    { key: "fceumm_sprite_limit", description: "Sprite Limit", choices: ["enabled", "disabled"], value: "enabled" },
    { key: "fceumm_region", description: "Region", choices: ["auto", "ntsc", "pal"], value: "auto" },
    { key: "fceumm_overclock", description: "Overclocking", choices: ["0", "1", "2"], value: "0" },
  ],
  get_core_option: null,
  set_core_option: null,

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

  // --- Controller (src/ipc/controllers.ts; set_binding/reset_bindings added
  //     by W267's remap UI) ---
  list_bindings: [],
  set_binding: { id: 1, deviceFamily: "xbox", action: "confirm", button: "faceDown" },
  reset_bindings: null,

  // --- Launch / RetroArch (src/ipc/launch.ts) ---
  locate_retroarch: "/Applications/RetroArch.app/Contents/MacOS/RetroArch",
  // W26A — the external (RetroArch-only) TV takeover fires launch_game itself;
  // returning void (null) lets TvExternalSurface report "Running in RetroArch"
  // without warning. void = null in the mock.
  launch_game: null,

  // --- Native play (src/ipc/native-play.ts, v0.21) — the TV takeover mounts
  //     PlaySwitch, which resolves the native-play opt-in for the native-
  //     candidate system on every launch; without these the smoke walk warns
  //     "[mock-ipc] no fixture" on every takeover (W26A console hygiene). Native
  //     hosting is off by default (get_native_play_enabled: false → the in-page
  //     path is taken, matching a fresh install), and the session/input writes
  //     are void. ---
  get_native_play_enabled: false,
  // W340 multi-system engine: PlaySwitch fetches the native capability map on
  // mount. Mirrors the full NATIVE_SYSTEMS table (play/native/systems.rs) so
  // the smoke walk exercises the real capability shape; only NES has its core
  // installed, matching a fresh install.
  list_native_systems: [
    { system: "nes", coreId: "fceumm", coreInstalled: true },
    { system: "snes", coreId: "snes9x", coreInstalled: false },
    { system: "genesis", coreId: "genesis_plus_gx", coreInstalled: false },
    { system: "mastersystem", coreId: "genesis_plus_gx", coreInstalled: false },
    { system: "gb", coreId: "gambatte", coreInstalled: false },
    { system: "gbc", coreId: "gambatte", coreInstalled: false },
    { system: "gba", coreId: "mgba", coreInstalled: false },
    { system: "atari2600", coreId: "stella", coreInstalled: false },
    { system: "pcengine", coreId: "mednafen_pce", coreInstalled: false },
    { system: "n64", coreId: "mupen64plus_next", coreInstalled: false },
    { system: "ps1", coreId: "pcsx_rearmed", coreInstalled: false },
  ],
  set_native_play_enabled: null,
  start_native_play: null,
  stop_native_play: null,
  set_native_input: null,
  // v0.35 "Player Two" W350 — release-all-ports contract used by overlay
  // open / session teardown.
  release_all_native_input: null,

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
  // v0.26 W263 — per-tier hi-res pipeline. W26A: return a real (data-URI)
  // boxart tier so the art resolvers paint a cover on every surface headlessly
  // — the TV home is ART-FORWARD (cover tiles + hero backdrop) and the takeover
  // cover layer has art to expand. The mock ignores the gameId arg, so every
  // game resolves the SAME cover; that is fine for a deterministic smoke visual.
  // Boxart-only so both the tile order (boxart→title→snap) and the hero order
  // (snap→title→boxart) fall through to it. `fetch_game_art` still returns the
  // empty-string miss (nothing is left to fetch once the tier is cached).
  get_cached_art_tiers: [{ tier: "boxart", path: MOCK_COVER_DATA_URI }],
  fetch_game_art: "",
  enrich_game_metadata: { id: 1, path: "/roms/nes/Super Mario Bros. 3.nes", system: "nes", crc32: "0b742b33", md5: null, cleanName: "Super Mario Bros. 3", datMatched: true, coreHint: "mesen", artPath: null, sizeBytes: 393216, addedAt: NOW, year: 1988, developer: "Nintendo R&D4", publisher: "Nintendo", aliases: ["SMB3"], description: "A platform game.", wikipediaUrl: "https://en.wikipedia.org/wiki/Super_Mario_Bros._3", favorite: true, lastPlayedAt: NOW / 1000, playCount: 5, totalPlayTimeMs: 3_600_000 },
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
  // W239 raw-bytes frame poll — null parses as "nothing to paint".
  get_native_frame: null,
  // v0.24 W241 on-demand in-page cores — fresh install has none cached.
  list_inpage_cores: [],
  install_inpage_core: null,
  // v0.24 W243 player conveniences.
  get_player_prefs: { volume: 1, pauseOnBlur: true },
  set_player_prefs: null,
  // v0.24 W244 direct download.
  start_download: 1,
  cancel_download: null,
  discard_staged_download: null,
  // v0.25 W250 provider API auto-discovery.
  discover_provider: [],
  // v0.26 W264 "library life" — favorites, recently-played, play-time. The two
  // list slices return the SAME game records as list_games so the TV home (W261)
  // renders self-consistent Continue-playing + Favorites shelves headlessly:
  //   - recently-played: every played game, most-recently-played first.
  //   - favorites: every favorited game (ordered by title, mirroring the backend).
  set_favorite: null,
  record_play_start: 1,
  record_play_end: null,
  list_recently_played: MOCK_GAMES
    .filter((g) => g.lastPlayedAt != null)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt),
  list_favorites: MOCK_GAMES
    .filter((g) => g.favorite)
    .sort((a, b) => a.cleanName.localeCompare(b.cleanName)),
  // v0.37 W373 — user collections (collections-design.md). One populated
  // collection so the TV home renders a real collection rail headlessly
  // (mirrors the Favorites/Continue-playing self-consistency above); its
  // members are drawn from MOCK_GAMES so `list_games_by_collection` and
  // `list_collection_ids_for_game` agree with each other and with the library.
  create_collection: { id: 1, name: "Couch co-op", createdAt: NOW, sort: 0 },
  rename_collection: null,
  delete_collection: null,
  list_collections: [{ id: 1, name: "Couch co-op", createdAt: NOW, sort: 0, gameCount: 2 }],
  add_game_to_collection: null,
  remove_game_from_collection: null,
  list_games_by_collection: MOCK_GAMES.filter((g) => g.id === 1 || g.id === 4),
  list_collection_ids_for_game: [1],
  // v0.26 W260 — TV mode auto-enter. The dedicated `tv-home` mock route
  // (scripts/visual-inspect.mjs) overrides this to `true`; every other route
  // keeps the desktop default of `false`.
  get_auto_tv_mode: false,
  set_auto_tv_mode: null,
  // v0.29 W280 — CRT filter config (crt-filter-design.md). useCrtFilter is read
  // by BOTH players (mounted on game-detail/takeover routes) and CrtFilterPane,
  // so this fixture must exist for any route that can mount a player — missing
  // it was a pre-existing gap (predates this file's W281 additions) that
  // surfaced once a route actually drove a settings-panel interaction deep
  // enough to hit it. Off preset (every intensity 0) mirrors the real default.
  get_crt_filter: { scanlines: 0, curvature: 0, colorBleed: 0, vignette: 0, preset: "off" },
  set_crt_filter: null,
  // v0.29 W281 — emulation performance tooling (performance-tooling-design.md).
  // A fresh install has no logged sessions yet, so both reads return an empty
  // series — the panel's own empty-state hint covers that headlessly.
  get_show_fps_counter: false,
  set_show_fps_counter: null,
  report_ejs_perf_stats: null,
  read_native_perf_log: { lines: [], fpsSeries: [] },
  read_ejs_perf_log: { lines: [], fpsSeries: [] },
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
