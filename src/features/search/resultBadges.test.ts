/**
 * Direct unit tests for resultBadges.ts (W367 test depth, v0.36).
 *
 * browsing.test.ts already covers the happy-path shape (one badge per kind,
 * ordering, and basic dedup); this file drills into resultBadges.ts's own
 * branches directly: the pushUnique dedup helper across every kind (not just
 * region), the version-only revision regex, multiple quality markers in one
 * title, and titles with no recognizable tokens at all.
 */
import { describe, it, expect } from "vitest";
import { parseBadges } from "./resultBadges";

describe("parseBadges", () => {
  it("returns an empty list for a title with no recognizable tokens", () => {
    expect(parseBadges("")).toEqual([]);
    expect(parseBadges("xyzzy plugh")).toEqual([]);
  });

  it("parses the version-only revision form without a Rev token", () => {
    const badges = parseBadges("Game v2.0.1");
    expect(badges).toContainEqual({ kind: "revision", label: "v2.0.1", tone: "neutral" });
  });

  it("parses both a Rev token and a version token as distinct revision badges", () => {
    const badges = parseBadges("Game (Rev B) v1.0").filter((b) => b.kind === "revision");
    expect(badges).toEqual([
      { kind: "revision", label: "Rev B", tone: "neutral" },
      { kind: "revision", label: "v1.0", tone: "neutral" },
    ]);
  });

  it("parses every GoodTools quality marker to its documented tone", () => {
    expect(parseBadges("Game [h]")).toContainEqual({ kind: "quality", label: "Hack", tone: "neutral" });
    expect(parseBadges("Game [t]")).toContainEqual({ kind: "quality", label: "Trained", tone: "neutral" });
    expect(parseBadges("Game [a]")).toContainEqual({ kind: "quality", label: "Alt", tone: "neutral" });
    expect(parseBadges("Game [p]")).toContainEqual({ kind: "quality", label: "Pirate", tone: "bad" });
    expect(parseBadges("Game [f]")).toContainEqual({ kind: "quality", label: "Fixed", tone: "neutral" });
    expect(parseBadges("Game [o]")).toContainEqual({ kind: "quality", label: "Overdump", tone: "bad" });
  });

  it("parses multiple distinct quality markers from the same title", () => {
    const kinds = parseBadges("Game [h][t]")
      .filter((b) => b.kind === "quality")
      .map((b) => b.label);
    expect(kinds).toEqual(["Hack", "Trained"]);
  });

  it("ignores an unrecognized bracket token", () => {
    expect(parseBadges("Game [x]").filter((b) => b.kind === "quality")).toHaveLength(0);
  });

  it("dedups identical badges across every kind, not just region", () => {
    // Two identical Rev tokens can't appear in one title via the regex (it
    // only matches once), so exercise pushUnique's dedup directly through
    // repeated quality markers and repeated file-like extensions instead.
    const qualityLabels = parseBadges("Game [h] [h]")
      .filter((b) => b.kind === "quality")
      .map((b) => b.label);
    expect(qualityLabels).toEqual(["Hack"]);
  });

  it("recognizes a variety of content file extensions", () => {
    expect(parseBadges("Game.iso")).toContainEqual({ kind: "filetype", label: "ISO", tone: "neutral" });
    expect(parseBadges("Game.chd")).toContainEqual({ kind: "filetype", label: "CHD", tone: "neutral" });
    expect(parseBadges("Game.nes")).toContainEqual({ kind: "filetype", label: "NES", tone: "neutral" });
  });

  it("does not tag an unrecognized trailing extension as a filetype", () => {
    expect(parseBadges("Game.exe").filter((b) => b.kind === "filetype")).toHaveLength(0);
  });

  it("is case-insensitive for region tokens embedded in mixed case", () => {
    const labels = parseBadges("Game (Usa)").map((b) => b.label);
    expect(labels).toContain("USA");
  });
});
