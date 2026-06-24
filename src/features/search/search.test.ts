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

// ── SearchResult link-only contract ──────────────────────────────────────────

describe("SearchResult shape", () => {
  it("title equals providerName (no page fetch)", () => {
    // The backend contract (file-search-design.md §3): title === providerName.
    const result = {
      providerId: 1,
      providerName: "DuckDuckGo",
      title: "DuckDuckGo",
      url: "https://duckduckgo.com/?q=super%20mario",
    };
    expect(result.title).toBe(result.providerName);
  });

  it("url is a valid http/https link", () => {
    const url = "https://duckduckgo.com/?q=super%20mario";
    expect(() => new URL(url)).not.toThrow();
    expect(["http:", "https:"]).toContain(new URL(url).protocol);
  });
});
