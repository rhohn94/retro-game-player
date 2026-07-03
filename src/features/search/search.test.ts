/**
 * Unit tests for the W17 search feature — pure logic that does not require a
 * DOM or Tauri runtime. We test the form-validation helper inline here.
 *
 * The IPC layer (listProviders, runSearch, etc.) is tested by the backend unit
 * tests in src-tauri; these tests cover the TS-side invariants only.
 */
import { describe, it, expect } from "vitest";

// ── Inline extraction of the validation function ─────────────────────────────
// The real validate() lives in ProviderDialog.tsx (a React component file, not
// importable in a node environment). We re-define the pure logic here to keep
// the test layer framework-free and importable without a DOM.

interface ProviderFormData {
  name: string;
  urlTemplate: string;
}

function validate(data: ProviderFormData): string | null {
  if (!data.name.trim()) return "Name is required.";
  if (!data.urlTemplate.trim()) return "URL template is required.";
  if (!data.urlTemplate.includes("{query}"))
    return "URL template must contain the {query} placeholder.";
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validate (ProviderDialog)", () => {
  it("accepts a valid provider form", () => {
    expect(
      validate({ name: "DuckDuckGo", urlTemplate: "https://duckduckgo.com/?q={query}" })
    ).toBeNull();
  });

  it("rejects blank name", () => {
    expect(
      validate({ name: "   ", urlTemplate: "https://example.com?q={query}" })
    ).toMatch(/Name is required/);
  });

  it("rejects blank urlTemplate", () => {
    expect(validate({ name: "Test", urlTemplate: "" })).toMatch(
      /URL template is required/
    );
  });

  it("rejects urlTemplate missing {query}", () => {
    expect(
      validate({ name: "Test", urlTemplate: "https://example.com/search" })
    ).toMatch(/\{query\}/);
  });

  it("allows {query} anywhere in the template", () => {
    expect(
      validate({ name: "X", urlTemplate: "{query}.example.com" })
    ).toBeNull();
  });
});

// ── ProviderResults preview contract (v0.16) ─────────────────────────────────

describe("ProviderResults shape", () => {
  // The v0.16 backend returns one group per provider: the constructed
  // searchUrl, the scraped preview items, and an optional error. The app opens
  // links in the browser; since v0.24 (W244) providers with the per-vendor
  // direct_download opt-in also get an explicit in-row download action
  // (direct-download-design.md) — run_search itself still never fetches content.
  const group = {
    providerId: 5,
    providerName: "Internet Archive",
    searchUrl: "https://archive.org/search?query=mario",
    directDownload: false,
    items: [
      { title: "Super Mario (USA)", url: "https://archive.org/details/mario-usa" },
      { title: "Mario Bros (World)", url: "https://archive.org/details/mario-world" },
    ],
    error: null,
  };

  it("always carries a constructed searchUrl as the browser fallback", () => {
    expect(() => new URL(group.searchUrl)).not.toThrow();
    expect(["http:", "https:"]).toContain(new URL(group.searchUrl).protocol);
  });

  it("each previewed item has its own title and http(s) url", () => {
    for (const item of group.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(["http:", "https:"]).toContain(new URL(item.url).protocol);
    }
  });

  it("models a per-provider fetch failure without items", () => {
    const failed = {
      ...group,
      items: [] as { title: string; url: string }[],
      error: "network error: provider returned status 503",
    };
    expect(failed.items).toHaveLength(0);
    expect(failed.error).toMatch(/network error/);
    // The searchUrl still lets the user open the page in their browser.
    expect(failed.searchUrl).toBeTruthy();
  });

  it("direct-download is an opt-in capability flag, off by default", () => {
    expect(group.directDownload).toBe(false);
  });
});
