// Unit tests for the in-page-play system mapping (v0.15). This is the gate that
// decides whether a game plays in-page (bundled WASM core) or falls back to the
// native external-RetroArch launch, so the contract is worth pinning down: only
// systems with a vendored core resolve, and the two helpers stay consistent.
import { describe, it, expect } from "vitest";
import { EJS_SYSTEM, inPageSystem, canPlayInPage } from "./ejs";

describe("inPageSystem", () => {
  it("maps a bundled-core system to its EmulatorJS key", () => {
    expect(inPageSystem("nes")).toBe("nes");
  });

  it("returns undefined for a system with no bundled in-page core", () => {
    // gen-6 / BIOS-gated systems fall back to the native launch.
    expect(inPageSystem("psx")).toBeUndefined();
    expect(inPageSystem("snes")).toBeUndefined();
    expect(inPageSystem("")).toBeUndefined();
  });

  it("does not resolve inherited Object keys", () => {
    expect(inPageSystem("toString")).toBeUndefined();
    expect(inPageSystem("constructor")).toBeUndefined();
  });
});

describe("canPlayInPage", () => {
  it("is true exactly for the systems in the mapping", () => {
    expect(canPlayInPage("nes")).toBe(true);
    expect(canPlayInPage("psx")).toBe(false);
    expect(canPlayInPage("")).toBe(false);
  });

  it("agrees with inPageSystem for every mapped and unmapped key", () => {
    for (const system of Object.keys(EJS_SYSTEM)) {
      expect(canPlayInPage(system)).toBe(true);
      expect(inPageSystem(system)).toBeDefined();
    }
    for (const system of ["psx", "saturn", "3do", "n64", "unknown"]) {
      expect(canPlayInPage(system)).toBe(inPageSystem(system) !== undefined);
    }
  });
});
