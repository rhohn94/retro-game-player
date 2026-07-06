// Unit tests for the TV rail composition + windowing (v0.26 W261). Pure, DOM-
// free: buildRails ordering/hiding, tileFocusId scoping, and railWindow's
// windowed-slice math around the focused tile.

import { describe, it, expect } from "vitest";
import type { Game } from "../../ipc/library";
import type { CollectionWithCount } from "../../ipc/collections";
import {
  buildRails,
  collectionRailId,
  railWindow,
  systemRailId,
  tileFocusId,
  MAX_COLLECTION_RAILS,
  RAIL_CONTINUE,
  RAIL_DESKTOP,
  RAIL_FAVORITES,
  RAIL_RECENT,
  RECENTLY_ADDED_LIMIT,
  WINDOW_THRESHOLD,
} from "./rails";

/** Minimal CollectionWithCount factory. */
function collection(id: number, name: string, gameCount: number): CollectionWithCount {
  return { id, name, createdAt: id, sort: 0, gameCount };
}

/** Minimal Game factory — only the fields the rail composition reads. */
function game(id: number, over: Partial<Game> = {}): Game {
  return {
    id,
    path: `/roms/g${id}`,
    system: "nes",
    crc32: null,
    md5: null,
    cleanName: `Game ${id}`,
    datMatched: true,
    coreHint: null,
    artPath: null,
    sizeBytes: 0,
    addedAt: id, // ascending addedAt by id unless overridden
    year: null,
    developer: null,
    publisher: null,
    aliases: [],
    description: null,
    wikipediaUrl: null,
    favorite: false,
    lastPlayedAt: null,
    playCount: 0,
    totalPlayTimeMs: 0,
    source: "rom",
    launchDescriptor: null,
    externalId: null,
    ...over,
  };
}

describe("buildRails (v0.26 W261)", () => {
  it("emits the three built-in rails then per-system rails, in order", () => {
    const games = [
      game(1, { system: "nes", addedAt: 100, lastPlayedAt: 50 }),
      game(2, { system: "snes", addedAt: 200, lastPlayedAt: 90 }),
    ];
    const rails = buildRails({
      games,
      recentlyPlayed: [games[1], games[0]],
      favorites: [games[0]],
    });
    expect(rails.map((r) => r.id)).toEqual([
      RAIL_CONTINUE,
      RAIL_FAVORITES,
      RAIL_RECENT,
      // snes leads nes: its game was played more recently (90 > 50).
      systemRailId("snes"),
      systemRailId("nes"),
    ]);
  });

  it("drops an empty built-in rail rather than showing a labelled blank shelf", () => {
    const games = [game(1, { system: "nes" })];
    const rails = buildRails({ games, recentlyPlayed: [], favorites: [] });
    // No recently-played and no favorites → only Recently added + the nes rail.
    expect(rails.map((r) => r.id)).toEqual([RAIL_RECENT, systemRailId("nes")]);
  });

  it("returns no rails at all for an empty library", () => {
    expect(buildRails({ games: [], recentlyPlayed: [], favorites: [] })).toEqual([]);
  });

  it("caps Recently added at RECENTLY_ADDED_LIMIT, newest first", () => {
    const games = Array.from({ length: RECENTLY_ADDED_LIMIT + 5 }, (_, i) =>
      game(i + 1, { addedAt: i + 1 }),
    );
    const rails = buildRails({ games, recentlyPlayed: [], favorites: [] });
    const recent = rails.find((r) => r.id === RAIL_RECENT);
    expect(recent).toBeDefined();
    expect(recent!.games).toHaveLength(RECENTLY_ADDED_LIMIT);
    // Newest addedAt first.
    expect(recent!.games[0].addedAt).toBe(RECENTLY_ADDED_LIMIT + 5);
  });

  it("groups every system that has a game into its own rail", () => {
    const games = [
      game(1, { system: "nes" }),
      game(2, { system: "snes" }),
      game(3, { system: "genesis" }),
    ];
    const rails = buildRails({ games, recentlyPlayed: [], favorites: [] });
    const systemRailIds = rails
      .map((r) => r.id)
      .filter((id) => id.startsWith("rail:system:"));
    expect(systemRailIds).toContain(systemRailId("nes"));
    expect(systemRailIds).toContain(systemRailId("snes"));
    expect(systemRailIds).toContain(systemRailId("genesis"));
  });

  it("groups every non-retro row into a trailing Desktop rail, newest first (v0.31 W315)", () => {
    const games = [
      game(1, { system: "nes" }),
      game(2, { system: null, source: "steam", addedAt: 300 }),
      game(3, { system: null, source: "app", addedAt: 400 }),
    ];
    const rails = buildRails({ games, recentlyPlayed: [], favorites: [] });
    const desktop = rails.find((r) => r.id === RAIL_DESKTOP);
    expect(desktop).toBeDefined();
    expect(rails[rails.length - 1].id).toBe(RAIL_DESKTOP); // trails every other rail
    expect(desktop!.games.map((g) => g.id)).toEqual([3, 2]); // newest addedAt first
  });

  it("omits the Desktop rail entirely when every row is a ROM (v0.31 W315)", () => {
    const games = [game(1, { system: "nes" })];
    const rails = buildRails({ games, recentlyPlayed: [], favorites: [] });
    expect(rails.some((r) => r.id === RAIL_DESKTOP)).toBe(false);
  });

  // --- v0.37 W373: one rail per non-empty collection, after Favorites ---

  it("emits one rail per non-empty collection right after Favorites", () => {
    const g1 = game(1, { system: "nes" });
    const g2 = game(2, { system: "snes" });
    const rails = buildRails({
      games: [g1, g2],
      recentlyPlayed: [],
      favorites: [g1],
      collections: [collection(10, "Couch co-op", 1)],
      collectionGames: new Map([[10, [g2]]]),
    });
    // Favorites, then the collection rail, then everything else (order among
    // the "everything else" rails is covered by other tests).
    expect(rails[0].id).toBe(RAIL_FAVORITES);
    expect(rails[1].id).toBe(collectionRailId(10));
    expect(rails.map((r) => r.id)).toContain(RAIL_RECENT);
    const rail = rails.find((r) => r.id === collectionRailId(10));
    expect(rail?.label).toBe("Couch co-op");
    expect(rail?.games.map((g) => g.id)).toEqual([2]);
  });

  it("omits a collection's rail entirely when it has no games", () => {
    const games = [game(1, { system: "nes" })];
    const rails = buildRails({
      games,
      recentlyPlayed: [],
      favorites: [],
      collections: [collection(10, "Empty Shelf", 0)],
      collectionGames: new Map([[10, []]]),
    });
    expect(rails.some((r) => r.id === collectionRailId(10))).toBe(false);
  });

  it("omits a collection's rail when its member fetch has not resolved yet", () => {
    const games = [game(1, { system: "nes" })];
    const rails = buildRails({
      games,
      recentlyPlayed: [],
      favorites: [],
      collections: [collection(10, "Still Loading", 3)],
      collectionGames: new Map(), // id 10 absent — not yet fetched
    });
    expect(rails.some((r) => r.id === collectionRailId(10))).toBe(false);
  });

  it("emits no collection rails when collectionGames is absent (pre-W373 callers)", () => {
    const games = [game(1, { system: "nes" })];
    const rails = buildRails({
      games,
      recentlyPlayed: [],
      favorites: [],
      collections: [collection(10, "Couch co-op", 1)],
    });
    expect(rails.some((r) => r.id.startsWith("rail:collection:"))).toBe(false);
  });

  it("preserves the backend's collection order and caps at MAX_COLLECTION_RAILS", () => {
    const games = Array.from({ length: MAX_COLLECTION_RAILS + 5 }, (_, i) => game(i + 1));
    const collections = games.map((g) => collection(g.id, `Shelf ${g.id}`, 1));
    const collectionGames = new Map(games.map((g) => [g.id, [g]]));
    const rails = buildRails({ games, recentlyPlayed: [], favorites: [], collections, collectionGames });
    const collectionRailIds = rails.map((r) => r.id).filter((id) => id.startsWith("rail:collection:"));
    expect(collectionRailIds).toHaveLength(MAX_COLLECTION_RAILS);
    expect(collectionRailIds[0]).toBe(collectionRailId(games[0].id));
  });
});

describe("tileFocusId (v0.26 W261)", () => {
  it("scopes the same game to distinct ids per rail", () => {
    expect(tileFocusId(RAIL_CONTINUE, 7)).not.toBe(tileFocusId(systemRailId("nes"), 7));
    expect(tileFocusId(RAIL_CONTINUE, 7)).toBe(`${RAIL_CONTINUE}:7`);
  });
});

describe("railWindow (v0.26 W261)", () => {
  it("returns the whole list unchanged below the threshold", () => {
    const items = Array.from({ length: WINDOW_THRESHOLD - 1 }, (_, i) => i);
    const win = railWindow(items, 0, 12);
    expect(win.start).toBe(0);
    expect(win.total).toBe(items.length);
    expect(win.items).toHaveLength(items.length);
  });

  it("windows a long list around the focused index", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const win = railWindow(items, 100, 12);
    expect(win.total).toBe(200);
    expect(win.items).toHaveLength(25); // radius*2 + 1
    expect(win.start).toBe(88); // 100 - 12
    expect(win.items[0]).toBe(88);
  });

  it("clamps the window to the list head when focus is near the start", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const win = railWindow(items, 0, 12);
    expect(win.start).toBe(0);
    expect(win.items[0]).toBe(0);
  });

  it("clamps the window to the list tail when focus is near the end", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const win = railWindow(items, 199, 12);
    expect(win.start).toBe(200 - 25); // total - (radius*2+1)
    expect(win.items[win.items.length - 1]).toBe(199);
  });

  it("treats an unfocused (-1) long rail as showing its head", () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const win = railWindow(items, -1, 12);
    expect(win.start).toBe(0);
    expect(win.items[0]).toBe(0);
  });
});
