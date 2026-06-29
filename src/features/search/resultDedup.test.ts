/**
 * Unit tests for the v0.19 "Reach" cross-provider dedupe — the pure module that
 * collapses the same game found across several providers into one game-first row.
 * Framework-free (node); the SearchPage wiring is exercised by the headless
 * mock-IPC screenshot pass during implementation.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  dedupeAcrossProviders,
  type DedupGroup,
} from "./resultDedup";

describe("normalizeTitle", () => {
  it("lowercases and strips bracketed region/quality groups", () => {
    expect(normalizeTitle("Super Mario Bros. 3 (USA)")).toBe("super mario bros 3");
    expect(normalizeTitle("Sonic (Europe) [!]")).toBe("sonic");
    expect(normalizeTitle("Chrono Trigger (Japan) (Rev A)")).toBe("chrono trigger");
  });

  it("strips a trailing file extension", () => {
    expect(normalizeTitle("Contra (USA).zip")).toBe("contra");
    expect(normalizeTitle("Metroid.sfc")).toBe("metroid");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeTitle("  The   Legend of Zelda:  A Link  ")).toBe(
      "the legend of zelda a link"
    );
  });

  it("collapses the same game from different regions onto one key", () => {
    expect(normalizeTitle("Sonic (USA)")).toBe(normalizeTitle("Sonic (Europe)"));
  });

  it("does NOT merge genuinely different titles (never drops words)", () => {
    expect(normalizeTitle("Sonic 2")).not.toBe(normalizeTitle("Sonic 3"));
    expect(normalizeTitle("Mario Kart")).not.toBe(normalizeTitle("Mario Party"));
  });

  it("returns empty when nothing identifying survives", () => {
    expect(normalizeTitle("(USA)")).toBe("");
    expect(normalizeTitle("...")).toBe("");
  });
});

describe("dedupeAcrossProviders", () => {
  const groups: DedupGroup[] = [
    {
      providerId: 1,
      providerName: "Internet Archive",
      items: [
        { title: "Super Mario Bros. 3 (USA)", url: "https://a/smb3-usa" },
        { title: "Sonic (USA)", url: "https://a/sonic-usa" },
      ],
    },
    {
      providerId: 2,
      providerName: "PDRoms",
      items: [
        { title: "Super Mario Bros 3 (Europe)", url: "https://b/smb3-eur" },
        { title: "Contra", url: "https://b/contra" },
      ],
    },
  ];

  it("merges the same game across providers into one row with N sources", () => {
    const merged = dedupeAcrossProviders(groups);
    const smb3 = merged.find((m) => m.key === "super mario bros 3");
    expect(smb3).toBeDefined();
    expect(smb3!.sources).toHaveLength(2);
    expect(smb3!.sources.map((s) => s.providerName)).toEqual([
      "Internet Archive",
      "PDRoms",
    ]);
  });

  it("keeps games found in only one provider as single-source rows", () => {
    const merged = dedupeAcrossProviders(groups);
    expect(merged.find((m) => m.key === "sonic")!.sources).toHaveLength(1);
    expect(merged.find((m) => m.key === "contra")!.sources).toHaveLength(1);
  });

  it("preserves first-appearance order", () => {
    const keys = dedupeAcrossProviders(groups).map((m) => m.key);
    expect(keys).toEqual(["super mario bros 3", "sonic", "contra"]);
  });

  it("uses the first source's verbatim title as the display title", () => {
    const smb3 = dedupeAcrossProviders(groups).find(
      (m) => m.key === "super mario bros 3"
    );
    expect(smb3!.title).toBe("Super Mario Bros. 3 (USA)");
  });

  it("does not double-count the same URL listed twice", () => {
    const dupes: DedupGroup[] = [
      {
        providerId: 1,
        providerName: "X",
        items: [
          { title: "Game (USA)", url: "https://x/g" },
          { title: "Game (Europe)", url: "https://x/g" }, // same URL
        ],
      },
    ];
    const merged = dedupeAcrossProviders(dupes);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toHaveLength(1);
  });

  it("falls back to a per-URL key when a title normalizes to empty", () => {
    const empties: DedupGroup[] = [
      {
        providerId: 1,
        providerName: "X",
        items: [
          { title: "(USA)", url: "https://x/1" },
          { title: "[!]", url: "https://x/2" },
        ],
      },
    ];
    const merged = dedupeAcrossProviders(empties);
    // Distinct URLs, both empty-normalized → kept separate, never merged/dropped.
    expect(merged).toHaveLength(2);
  });

  it("returns an empty list for no groups", () => {
    expect(dedupeAcrossProviders([])).toEqual([]);
  });
});
