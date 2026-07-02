// Guards the system→EJS_core mapping (v0.15; multi-core since v0.24 W241) —
// especially the own-property check that keeps prototype-key system strings
// from ever resolving to a "core".

import { describe, expect, it } from "vitest";
import { EJS_SYSTEM, inPageSystem, canPlayInPage, isEmbeddedInPage } from "./ejs";

describe("inPageSystem", () => {
  it("maps NES to the embedded EJS system alias", () => {
    expect(inPageSystem("nes")).toBe("nes");
    expect(isEmbeddedInPage("nes")).toBe(true);
  });

  it("maps the v0.24 on-demand systems to explicit core names", () => {
    expect(inPageSystem("snes")).toBe("snes9x");
    expect(inPageSystem("genesis")).toBe("genesis_plus_gx");
    expect(inPageSystem("mastersystem")).toBe("genesis_plus_gx");
    expect(inPageSystem("n64")).toBe("mupen64plus_next");
    expect(inPageSystem("ps1")).toBe("pcsx_rearmed");
    expect(inPageSystem("atari2600")).toBe("stella2014");
    expect(inPageSystem("pcengine")).toBe("mednafen_pce");
    expect(isEmbeddedInPage("snes")).toBe(false);
  });

  it("returns undefined for systems with no in-page core", () => {
    expect(inPageSystem("dreamcast")).toBeUndefined();
    expect(inPageSystem("ps2")).toBeUndefined();
    expect(inPageSystem("")).toBeUndefined();
  });

  it("never resolves Object.prototype keys as systems", () => {
    expect(inPageSystem("toString")).toBeUndefined();
    expect(inPageSystem("constructor")).toBeUndefined();
    expect(canPlayInPage("hasOwnProperty")).toBe(false);
  });

  it("keeps every mapped value a plain core/system token", () => {
    for (const value of Object.values(EJS_SYSTEM)) {
      expect(value).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe("canPlayInPage", () => {
  it("is true exactly for mapped systems", () => {
    expect(canPlayInPage("nes")).toBe(true);
    expect(canPlayInPage("snes")).toBe(true);
    expect(canPlayInPage("gamecube")).toBe(false);
  });
});
