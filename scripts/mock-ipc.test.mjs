// Guards the headless visual-inspection mock IPC (scripts/mock-ipc.mjs) against
// drift from the real IPC DTOs (src/ipc/*.ts). If a screen's fixture loses a
// field the component reads, the populated-UI render silently regresses — these
// tests fail fast instead.

import { describe, it, expect } from "vitest";
import { MOCK_FIXTURES, buildMockIpcInitScript } from "./mock-ipc.mjs";

const GAME_KEYS = [
  "id", "path", "system", "crc32", "md5", "cleanName",
  "datMatched", "coreHint", "artPath", "sizeBytes", "addedAt",
  // v0.6 metadata facets
  "year", "developer", "publisher", "aliases",
  // v0.26 W264 "library life" facets
  "favorite", "lastPlayedAt", "playCount", "totalPlayTimeMs",
];
const CORE_KEYS = [
  "id", "system", "coreId", "installedPath", "version",
  "lastModified", "active", "available",
];

describe("mock-ipc fixtures", () => {
  it("returns arrays for the list_* commands the screens load", () => {
    for (const cmd of ["list_games", "list_available_cores", "list_installed_cores", "list_providers", "list_content_folders", "list_bindings"]) {
      expect(Array.isArray(MOCK_FIXTURES[cmd]), `${cmd} must be an array`).toBe(true);
    }
  });

  it("shapes the W263 per-tier art fixtures like their IPC DTOs", () => {
    // get_cached_art_tiers returns CachedArtTier[]. W26A: a real (data-URI)
    // boxart tier so the TV home renders art-forward + the takeover cover has
    // art to expand, all headless. Still exactly the {tier,path} DTO shape.
    expect(Array.isArray(MOCK_FIXTURES.get_cached_art_tiers)).toBe(true);
    expect(MOCK_FIXTURES.get_cached_art_tiers.length).toBeGreaterThan(0);
    for (const entry of MOCK_FIXTURES.get_cached_art_tiers) {
      expect(Object.keys(entry).sort()).toEqual(["path", "tier"]);
      expect(["boxart", "title", "snap"]).toContain(entry.tier);
    }
    // The mock cover art must be a data: URI — the only art source that paints
    // in the headless harness (a filesystem path can't load; W26A).
    expect(MOCK_FIXTURES.get_cached_art_tiers[0].path).toMatch(/^data:image\//);
    // fetch_game_art mirrors fetch_boxart's string return (path or "" miss).
    expect(typeof MOCK_FIXTURES.fetch_game_art).toBe("string");
  });

  it("mocks the play/takeover-path commands so the TV takeover never warns (W26A)", () => {
    // The in-TV takeover mounts PlaySwitch, which resolves the native-play flag
    // (and, for external systems, fires launch_game). Missing fixtures warn
    // "[mock-ipc] no fixture" on every launch — a TV-surface console warning the
    // W26A gate forbids. These must stay present + correctly typed.
    for (const cmd of [
      "get_native_play_enabled",
      "set_native_play_enabled",
      "start_native_play",
      "stop_native_play",
      "set_native_input",
      "launch_game",
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(MOCK_FIXTURES, cmd),
        `${cmd} must have a fixture so the takeover doesn't warn`,
      ).toBe(true);
    }
    // Native hosting is off by default (a fresh install → the in-page path).
    expect(MOCK_FIXTURES.get_native_play_enabled).toBe(false);
  });

  it("shapes every game like the Game DTO", () => {
    expect(MOCK_FIXTURES.list_games.length).toBeGreaterThan(0);
    for (const g of MOCK_FIXTURES.list_games) {
      expect(Object.keys(g).sort()).toEqual([...GAME_KEYS].sort());
    }
  });

  it("shapes every core like the Core DTO", () => {
    expect(MOCK_FIXTURES.list_available_cores.length).toBeGreaterThan(0);
    for (const c of MOCK_FIXTURES.list_available_cores) {
      expect(Object.keys(c).sort()).toEqual([...CORE_KEYS].sort());
    }
  });

  it("covers all three v0.1 systems so the library filter has content", () => {
    const systems = new Set(MOCK_FIXTURES.list_games.map((g) => g.system));
    expect(systems).toContain("nes");
    expect(systems).toContain("snes");
    expect(systems).toContain("n64");
  });

  it("is JSON-serializable (it is injected via JSON.stringify)", () => {
    expect(() => JSON.stringify(MOCK_FIXTURES)).not.toThrow();
  });

  it("shapes set_binding like the ControllerBinding DTO (W267)", () => {
    expect(Object.keys(MOCK_FIXTURES.set_binding).sort()).toEqual(
      ["id", "deviceFamily", "action", "button"].sort(),
    );
  });

  it("reset_bindings returns void, like the Rust command (W267)", () => {
    expect(MOCK_FIXTURES.reset_bindings).toBeNull();
  });

  it("builds an init script that installs the Tauri internals shim", () => {
    const script = buildMockIpcInitScript();
    expect(script).toContain("__TAURI_INTERNALS__");
    expect(script).toContain("internals.invoke");
    expect(script).toContain("convertFileSrc");
  });
});
