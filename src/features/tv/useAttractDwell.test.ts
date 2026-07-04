// Fake-timer unit tests for AttractDwellTimer — the W273 hover-attract dwell
// core (tv-mode-design.md §v0.27 → W273 "Lifecycle"): fires at the threshold,
// resets on focus change, cancels on disable (takeover / exit-confirm), and
// only ever fires for an eligible candidate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../ipc/library";
import { AttractDwellTimer, TV_ATTRACT_DWELL_MS } from "./useAttractDwell";

/** Minimal Game factory — the dwell timer only reads `id`. */
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
    addedAt: id,
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

describe("AttractDwellTimer (W273 hover-attract dwell)", () => {
  let emitted: Array<Game | null>;
  let timer: AttractDwellTimer;

  beforeEach(() => {
    vi.useFakeTimers();
    emitted = [];
    timer = new AttractDwellTimer((g) => emitted.push(g));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the dwelt game exactly at the threshold, not before", () => {
    const g = game(7);
    timer.update({ key: "nes:7", game: g, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS - 1);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([g]);
  });

  it("resets the timer when the dwell key (focus) changes — full dwell again", () => {
    timer.update({ key: "nes:7", game: game(7), enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS - 1);
    const g8 = game(8);
    timer.update({ key: "nes:8", game: g8, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS - 1);
    expect(emitted).toEqual([]); // neither game accumulated a full dwell
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([g8]);
  });

  it("re-dwells from zero when the same game is reached via another tile", () => {
    const g = game(7);
    timer.update({ key: "favorites:7", game: g, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS - 1);
    timer.update({ key: "nes:7", game: g, enabled: true }); // tile change, same game
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS - 1);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([g]);
  });

  it("tears a fired preview down at once when focus moves on", () => {
    const g7 = game(7);
    timer.update({ key: "nes:7", game: g7, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS);
    expect(emitted).toEqual([g7]);
    timer.update({ key: "nes:8", game: game(8), enabled: true });
    expect(emitted).toEqual([g7, null]); // synchronous teardown, no timer wait
  });

  it("cancels the pending dwell when disabled (launch / exit-confirm)", () => {
    timer.update({ key: "nes:7", game: game(7), enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS - 1);
    timer.update({ key: "nes:7", game: game(7), enabled: false });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS * 2);
    expect(emitted).toEqual([]); // never fired, and no redundant null emit
  });

  it("tears a fired preview down when disabled, and re-dwells fully on re-enable", () => {
    const g = game(7);
    timer.update({ key: "nes:7", game: g, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS);
    timer.update({ key: "nes:7", game: g, enabled: false }); // takeover up
    expect(emitted).toEqual([g, null]);
    timer.update({ key: "nes:7", game: g, enabled: true }); // takeover ended
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS - 1);
    expect(emitted).toEqual([g, null]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual([g, null, g]);
  });

  it("never fires for an ineligible candidate (null game), however long it dwells", () => {
    timer.update({ key: "snes:9", game: null, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS * 3);
    expect(emitted).toEqual([]);
  });

  it("tears down and never re-fires when the dwelt game turns ineligible mid-preview", () => {
    const g = game(7);
    timer.update({ key: "nes:7", game: g, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS);
    timer.update({ key: "nes:7", game: null, enabled: true }); // e.g. preview start failed
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS * 2);
    expect(emitted).toEqual([g, null]);
  });

  it("ignores identical updates — a re-render never stretches the dwell", () => {
    const g = game(7);
    timer.update({ key: "nes:7", game: g, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS / 2);
    timer.update({ key: "nes:7", game: game(7), enabled: true }); // same id, new object
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS / 2);
    expect(emitted).toEqual([g]); // fired on the ORIGINAL schedule
  });

  it("dispose cancels the pending dwell and clears a fired preview", () => {
    const g = game(7);
    timer.update({ key: "nes:7", game: g, enabled: true });
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS);
    expect(emitted).toEqual([g]);
    timer.dispose();
    expect(emitted).toEqual([g, null]);

    const second = new AttractDwellTimer((x) => emitted.push(x));
    second.update({ key: "nes:8", game: game(8), enabled: true });
    second.dispose();
    vi.advanceTimersByTime(TV_ATTRACT_DWELL_MS * 2);
    expect(emitted).toEqual([g, null]); // disposed before firing → nothing more
  });
});
