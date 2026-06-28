// Unit tests for the pure library-filtering logic (v0.6 W62).
import { describe, it, expect } from "vitest";
import {
  EMPTY_CRITERIA,
  facetValues,
  filterGames,
  hasActiveFilters,
  type FilterCriteria,
} from "./filter";
import type { Game } from "../../ipc/commands";

function game(over: Partial<Game>): Game {
  return {
    id: 1,
    path: "/roms/x.nes",
    system: "nes",
    crc32: null,
    md5: null,
    cleanName: "Some Game",
    datMatched: false,
    coreHint: null,
    artPath: null,
    sizeBytes: 0,
    addedAt: 0,
    year: null,
    developer: null,
    publisher: null,
    aliases: [],
    ...over,
  };
}

const GAMES: Game[] = [
  game({ id: 1, system: "nes", cleanName: "Super Mario Bros. 3", year: 1988, developer: "Nintendo", publisher: "Nintendo", aliases: ["SMB3"] }),
  game({ id: 2, system: "snes", cleanName: "The Legend of Zelda: A Link to the Past", year: 1991, developer: "Nintendo EAD", publisher: "Nintendo", aliases: ["ALttP", "Zelda 3"] }),
  game({ id: 3, system: "snes", cleanName: "Super Metroid", year: 1994, developer: "Nintendo R&D1", publisher: "Nintendo" }),
  game({ id: 4, system: "n64", cleanName: "GoldenEye 007", year: 1997, developer: "Rare", publisher: "Nintendo" }),
  game({ id: 5, system: "nes", cleanName: "Plain Cart" }), // no metadata
];

describe("facetValues", () => {
  it("collects distinct, present values per facet", () => {
    const f = facetValues(GAMES);
    expect(f.systems).toEqual(["n64", "nes", "snes"]);
    expect(f.years).toEqual([1997, 1994, 1991, 1988]); // newest first
    expect(f.developers).toContain("Rare");
    expect(f.publishers).toEqual(["Nintendo"]); // deduped
  });

  it("omits null/absent values", () => {
    const f = facetValues([game({ year: null, developer: null, publisher: null })]);
    expect(f.years).toEqual([]);
    expect(f.developers).toEqual([]);
    expect(f.publishers).toEqual([]);
  });
});

describe("filterGames", () => {
  it("returns everything for empty criteria", () => {
    expect(filterGames(GAMES, EMPTY_CRITERIA)).toHaveLength(5);
  });

  it("filters by console", () => {
    const c: FilterCriteria = { ...EMPTY_CRITERIA, system: "snes" };
    expect(filterGames(GAMES, c).map((g) => g.id)).toEqual([2, 3]);
  });

  it("filters by year, developer, publisher (exact)", () => {
    expect(filterGames(GAMES, { ...EMPTY_CRITERIA, year: 1994 }).map((g) => g.id)).toEqual([3]);
    expect(filterGames(GAMES, { ...EMPTY_CRITERIA, developer: "Rare" }).map((g) => g.id)).toEqual([4]);
    expect(filterGames(GAMES, { ...EMPTY_CRITERIA, publisher: "Nintendo" })).toHaveLength(4);
  });

  it("matches the query against title", () => {
    expect(filterGames(GAMES, { ...EMPTY_CRITERIA, query: "metroid" }).map((g) => g.id)).toEqual([3]);
  });

  it("matches the query against aliases", () => {
    expect(filterGames(GAMES, { ...EMPTY_CRITERIA, query: "alttp" }).map((g) => g.id)).toEqual([2]);
    expect(filterGames(GAMES, { ...EMPTY_CRITERIA, query: "smb3" }).map((g) => g.id)).toEqual([1]);
  });

  it("combines facets with AND", () => {
    const c: FilterCriteria = { ...EMPTY_CRITERIA, system: "snes", query: "super" };
    expect(filterGames(GAMES, c).map((g) => g.id)).toEqual([3]); // Super Metroid only
  });
});

describe("hasActiveFilters", () => {
  it("is false for empty criteria and true once a facet is set", () => {
    expect(hasActiveFilters(EMPTY_CRITERIA)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_CRITERIA, system: "nes" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_CRITERIA, query: "x" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_CRITERIA, year: 1990 })).toBe(true);
  });
});
