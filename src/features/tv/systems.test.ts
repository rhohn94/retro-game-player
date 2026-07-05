// Unit tests for the TV system labels + recency ordering (v0.26 W261). Pure,
// DOM-free.

import { describe, it, expect } from "vitest";
import type { Game } from "../../ipc/library";
import { orderSystemsByRecency, tvSystemLabel } from "./systems";

function game(id: number, system: string, lastPlayedAt: number | null): Game {
  return {
    id,
    path: `/g${id}`,
    system,
    crc32: null,
    md5: null,
    cleanName: `Game ${id}`,
    datMatched: true,
    coreHint: null,
    artPath: null,
    sizeBytes: 0,
    addedAt: id,
    year: null,
    developer: null,
    publisher: null,
    aliases: [],
    description: null,
    wikipediaUrl: null,
    favorite: false,
    lastPlayedAt,
    playCount: 0,
    totalPlayTimeMs: 0,
    source: "rom",
    launchDescriptor: null,
    externalId: null,
  };
}

describe("tvSystemLabel (v0.26 W261)", () => {
  it("maps known system keys to proper console names", () => {
    expect(tvSystemLabel("nes")).toBe("NES");
    expect(tvSystemLabel("n64")).toBe("Nintendo 64");
    expect(tvSystemLabel("genesis")).toBe("Genesis");
    expect(tvSystemLabel("ps1")).toBe("PlayStation");
  });
  it("upper-cases an unknown key so a new system still reads as a label", () => {
    expect(tvSystemLabel("vectrex")).toBe("VECTREX");
  });
});

describe("orderSystemsByRecency (v0.26 W261)", () => {
  it("orders systems by their most-recently-played game first", () => {
    const games = [
      game(1, "nes", 50),
      game(2, "snes", 90),
      game(3, "genesis", 10),
    ];
    expect(orderSystemsByRecency(games)).toEqual(["snes", "nes", "genesis"]);
  });

  it("uses each system's BEST (max) lastPlayedAt, not its first game's", () => {
    const games = [
      game(1, "nes", 10),
      game(2, "snes", 20),
      game(3, "nes", 99), // nes now leads via its second game
    ];
    expect(orderSystemsByRecency(games)).toEqual(["nes", "snes"]);
  });

  it("trails never-played systems in first-seen order after played ones", () => {
    const games = [
      game(1, "genesis", null),
      game(2, "nes", 40),
      game(3, "snes", null),
    ];
    expect(orderSystemsByRecency(games)).toEqual(["nes", "genesis", "snes"]);
  });

  it("is deterministic for all-null (stable first-seen order)", () => {
    const games = [game(1, "snes", null), game(2, "nes", null)];
    expect(orderSystemsByRecency(games)).toEqual(["snes", "nes"]);
  });
});
