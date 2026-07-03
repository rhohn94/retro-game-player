// Unit tests for the art-source helper (W13) and the per-tier fallback
// resolver (W263). `convertFileSrc` is unavailable outside the Tauri webview,
// so artUrl must degrade to null rather than throw.

import { describe, expect, it } from "vitest";
import { artUrl, heroArtFor, SURFACE_TIER_ORDER } from "./art";

describe("artUrl", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(artUrl(null)).toBeNull();
    expect(artUrl(undefined)).toBeNull();
    expect(artUrl("")).toBeNull();
  });

  it("degrades to null when convertFileSrc is unavailable (non-Tauri context)", () => {
    // No window.__TAURI_INTERNALS__ in the test environment → guarded to null.
    expect(artUrl("/abs/path/to/cover.png")).toBeNull();
  });
});

describe("heroArtFor", () => {
  it("returns null when no tiers are cached", () => {
    expect(heroArtFor([], "hero")).toBeNull();
    expect(heroArtFor([], "tile")).toBeNull();
  });

  it("hero surface prefers snap, then title, then boxart", () => {
    const all = [
      { tier: "boxart" as const, path: "/art/box.png" },
      { tier: "title" as const, path: "/art/title.png" },
      { tier: "snap" as const, path: "/art/snap.png" },
    ];
    expect(heroArtFor(all, "hero")).toBe("/art/snap.png");
  });

  it("hero surface falls back to title when snap is missing", () => {
    const tiers = [
      { tier: "boxart" as const, path: "/art/box.png" },
      { tier: "title" as const, path: "/art/title.png" },
    ];
    expect(heroArtFor(tiers, "hero")).toBe("/art/title.png");
  });

  it("hero surface falls back to boxart when only boxart is cached", () => {
    const tiers = [{ tier: "boxart" as const, path: "/art/box.png" }];
    expect(heroArtFor(tiers, "hero")).toBe("/art/box.png");
  });

  it("tile surface prefers boxart, then title, then snap", () => {
    const all = [
      { tier: "snap" as const, path: "/art/snap.png" },
      { tier: "title" as const, path: "/art/title.png" },
      { tier: "boxart" as const, path: "/art/box.png" },
    ];
    expect(heroArtFor(all, "tile")).toBe("/art/box.png");
  });

  it("tile surface falls back to snap when boxart and title are missing", () => {
    const tiers = [{ tier: "snap" as const, path: "/art/snap.png" }];
    expect(heroArtFor(tiers, "tile")).toBe("/art/snap.png");
  });

  it("SURFACE_TIER_ORDER documents the two surfaces' full preference chains", () => {
    expect(SURFACE_TIER_ORDER.hero).toEqual(["snap", "title", "boxart"]);
    expect(SURFACE_TIER_ORDER.tile).toEqual(["boxart", "title", "snap"]);
  });
});
