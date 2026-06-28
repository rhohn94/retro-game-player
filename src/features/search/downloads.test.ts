import { describe, it, expect } from "vitest";
import {
  isDownloadProvider,
  partitionByKind,
  hasDownloadProviders,
  DOWNLOAD_KIND,
} from "./downloads";

const ref = (kind = "reference") => ({ kind });

describe("search-provider kind helpers (v0.11)", () => {
  it("identifies download providers", () => {
    expect(isDownloadProvider({ kind: DOWNLOAD_KIND })).toBe(true);
    expect(isDownloadProvider(ref())).toBe(false);
    expect(isDownloadProvider({ kind: "" })).toBe(false);
  });

  it("partitions providers by kind, preserving order", () => {
    const providers = [
      { name: "MobyGames", kind: "reference" },
      { name: "Internet Archive", kind: "download" },
      { name: "Wikipedia", kind: "reference" },
      { name: "itch.io", kind: "download" },
    ];
    const { downloads, reference } = partitionByKind(providers);
    expect(downloads.map((p) => p.name)).toEqual(["Internet Archive", "itch.io"]);
    expect(reference.map((p) => p.name)).toEqual(["MobyGames", "Wikipedia"]);
  });

  it("detects presence of download providers", () => {
    expect(hasDownloadProviders([ref(), { kind: "download" }])).toBe(true);
    expect(hasDownloadProviders([ref(), ref()])).toBe(false);
    expect(hasDownloadProviders([])).toBe(false);
  });
});
