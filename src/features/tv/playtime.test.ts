// Unit tests for the TV hero's play-time / last-played / meta-line formatting
// (v0.26 W261). Pure, DOM-free — no clock, no timers.

import { describe, it, expect } from "vitest";
import { formatLastPlayed, formatPlayTime, heroMetaLine } from "./playtime";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatPlayTime (v0.26 W261)", () => {
  it("formats sub-hour, hour, and hour+minute durations", () => {
    expect(formatPlayTime(45 * MIN)).toBe("45m");
    expect(formatPlayTime(3 * HOUR + 20 * MIN)).toBe("3h 20m");
    expect(formatPlayTime(12 * HOUR)).toBe("12h");
  });
  it("rounds a played-but-sub-minute duration up to 1m (never 0m)", () => {
    expect(formatPlayTime(30 * SEC)).toBe("1m");
  });
  it("returns null for a never-played / non-finite / negative duration", () => {
    expect(formatPlayTime(0)).toBeNull();
    expect(formatPlayTime(-5)).toBeNull();
    expect(formatPlayTime(Number.NaN)).toBeNull();
  });
});

describe("formatLastPlayed (v0.26 W261)", () => {
  // Fixed clock: NOW is unix ms; timestamps are unix SECONDS.
  const NOW_MS = 1_700_000_000_000;
  const secAt = (msAgo: number) => (NOW_MS - msAgo) / 1000;

  it("returns null when never played", () => {
    expect(formatLastPlayed(null, NOW_MS)).toBeNull();
  });
  it("buckets recent plays coarsely", () => {
    expect(formatLastPlayed(secAt(30 * SEC), NOW_MS)).toBe("Just now");
    expect(formatLastPlayed(secAt(5 * MIN), NOW_MS)).toBe("5 minutes ago");
    expect(formatLastPlayed(secAt(1 * MIN), NOW_MS)).toBe("1 minute ago");
    expect(formatLastPlayed(secAt(2 * HOUR), NOW_MS)).toBe("2 hours ago");
    expect(formatLastPlayed(secAt(1 * HOUR), NOW_MS)).toBe("1 hour ago");
    expect(formatLastPlayed(secAt(1 * DAY), NOW_MS)).toBe("Yesterday");
    expect(formatLastPlayed(secAt(3 * DAY), NOW_MS)).toBe("3 days ago");
    expect(formatLastPlayed(secAt(10 * DAY), NOW_MS)).toBe("1 week ago");
    expect(formatLastPlayed(secAt(20 * DAY), NOW_MS)).toBe("2 weeks ago");
  });
  it("shows month + year for plays older than a month", () => {
    const old = new Date("2021-06-15T12:00:00Z").getTime() / 1000;
    expect(formatLastPlayed(old, NOW_MS)).toBe("Jun 2021");
  });
  it("reads a future (clock-skew) timestamp as 'Just now'", () => {
    expect(formatLastPlayed(secAt(-10 * MIN), NOW_MS)).toBe("Just now");
  });
});

describe("heroMetaLine (v0.26 W261)", () => {
  it("joins system + year, or just the system when the year is unknown", () => {
    expect(heroMetaLine("SNES", 1991)).toBe("SNES · 1991");
    expect(heroMetaLine("SNES", null)).toBe("SNES");
  });
});
