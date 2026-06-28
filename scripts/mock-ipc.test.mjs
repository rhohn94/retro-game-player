// Guards the headless visual-inspection mock IPC (scripts/mock-ipc.mjs) against
// drift from the real IPC DTOs (src/ipc/*.ts). If a screen's fixture loses a
// field the component reads, the populated-UI render silently regresses — these
// tests fail fast instead.

import { describe, it, expect } from "vitest";
import { MOCK_FIXTURES, buildMockIpcInitScript } from "./mock-ipc.mjs";

const GAME_KEYS = [
  "id", "path", "system", "crc32", "md5", "cleanName",
  "datMatched", "coreHint", "artPath", "sizeBytes", "addedAt",
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

  it("builds an init script that installs the Tauri internals shim", () => {
    const script = buildMockIpcInitScript();
    expect(script).toContain("__TAURI_INTERNALS__");
    expect(script).toContain("internals.invoke");
    expect(script).toContain("convertFileSrc");
  });
});
