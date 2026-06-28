// Unit tests for the pure core browse/search logic (v0.7 W72).
import { describe, it, expect } from "vitest";
import { filterCores, flattenCores, groupBySystem } from "./coreFilter";
import type { Core } from "../../ipc/commands";

function core(over: Partial<Core>): Core {
  return {
    id: 1,
    system: "nes",
    coreId: "mesen",
    installedPath: null,
    version: null,
    lastModified: null,
    active: false,
    available: true,
    ...over,
  };
}

const BY_SYSTEM: Record<string, Core[]> = {
  snes: [core({ system: "snes", coreId: "snes9x" }), core({ system: "snes", coreId: "bsnes" })],
  nes: [core({ system: "nes", coreId: "mesen" }), core({ system: "nes", coreId: "quicknes" })],
  n64: [core({ system: "n64", coreId: "parallel_n64" })],
};

describe("flattenCores", () => {
  it("orders known systems first, then extras alphabetically", () => {
    const flat = flattenCores(BY_SYSTEM, ["nes", "snes", "n64"]);
    expect(flat.map((c) => c.coreId)).toEqual([
      "mesen", "quicknes", "snes9x", "bsnes", "parallel_n64",
    ]);
  });

  it("appends unknown systems after the known ones", () => {
    const withExtra = { ...BY_SYSTEM, gba: [core({ system: "gba", coreId: "mgba" })] };
    const flat = flattenCores(withExtra, ["nes", "snes", "n64"]);
    expect(flat[flat.length - 1].coreId).toBe("mgba");
  });
});

describe("filterCores", () => {
  const all = flattenCores(BY_SYSTEM, ["nes", "snes", "n64"]);

  it("returns everything for an empty query", () => {
    expect(filterCores(all, "")).toHaveLength(5);
    expect(filterCores(all, "  ")).toHaveLength(5);
  });

  it("matches by core id", () => {
    expect(filterCores(all, "snes9x").map((c) => c.coreId)).toEqual(["snes9x"]);
    expect(filterCores(all, "nes").map((c) => c.coreId)).toContain("quicknes");
  });

  it("matches by system", () => {
    expect(filterCores(all, "n64").map((c) => c.coreId)).toEqual(["parallel_n64"]);
  });

  it("is case-insensitive", () => {
    expect(filterCores(all, "MESEN").map((c) => c.coreId)).toEqual(["mesen"]);
  });
});

describe("groupBySystem", () => {
  it("regroups a flat list by system preserving order", () => {
    const flat = flattenCores(BY_SYSTEM, ["nes", "snes", "n64"]);
    const grouped = groupBySystem(filterCores(flat, "nes"));
    // "nes" matches the nes system (both cores) — quicknes also contains "nes".
    expect(Object.keys(grouped)).toContain("nes");
    expect(grouped.nes.map((c) => c.coreId)).toEqual(["mesen", "quicknes"]);
  });
});
