/**
 * Unit tests for the v0.20 "Atlas" provider template auto-detection — deriving a
 * {query} template from a pasted results URL + the term searched. Framework-free.
 */
import { describe, it, expect } from "vitest";
import { detectTemplate } from "./detectTemplate";

describe("detectTemplate", () => {
  it("replaces a simple query parameter value", () => {
    const r = detectTemplate("https://example.com/search?q=mario", "mario");
    expect(r.ok).toBe(true);
    expect(r.template).toBe("https://example.com/search?q={query}");
  });

  it("handles +-encoded spaces in the search term", () => {
    const r = detectTemplate(
      "https://example.com/search?q=super+mario+world",
      "super mario world"
    );
    expect(r.ok).toBe(true);
    expect(r.template).toBe("https://example.com/search?q={query}");
  });

  it("handles %20-encoded spaces", () => {
    const r = detectTemplate(
      "https://example.com/s?term=chrono%20trigger",
      "chrono trigger"
    );
    expect(r.ok).toBe(true);
    expect(r.template).toBe("https://example.com/s?term={query}");
  });

  it("detects a term in a path segment", () => {
    const r = detectTemplate("https://example.com/games/zelda", "zelda");
    expect(r.ok).toBe(true);
    expect(r.template).toBe("https://example.com/games/{query}");
  });

  it("matches case-insensitively but preserves the URL's casing elsewhere", () => {
    const r = detectTemplate("https://Example.com/Search?Q=Mario", "mario");
    expect(r.ok).toBe(true);
    expect(r.template).toBe("https://Example.com/Search?Q={query}");
  });

  it("returns the URL unchanged when it is already a template", () => {
    const r = detectTemplate("https://example.com/?q={query}", "");
    expect(r.ok).toBe(true);
    expect(r.template).toBe("https://example.com/?q={query}");
  });

  it("fails on an empty URL", () => {
    expect(detectTemplate("", "mario").ok).toBe(false);
  });

  it("fails on a non-http(s) URL", () => {
    const r = detectTemplate("ftp://example.com/?q=mario", "mario");
    expect(r.ok).toBe(false);
  });

  it("fails on a malformed URL", () => {
    expect(detectTemplate("not a url", "mario").ok).toBe(false);
  });

  it("fails when the sample term is missing", () => {
    const r = detectTemplate("https://example.com/search?q=mario", "");
    expect(r.ok).toBe(false);
    expect(r.template).toBeNull();
  });

  it("fails when the term is not present in the URL", () => {
    const r = detectTemplate("https://example.com/search?q=mario", "sonic");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("sonic");
  });
});
