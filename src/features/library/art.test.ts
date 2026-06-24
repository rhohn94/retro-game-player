// Unit tests for the art-source helper (W13). `convertFileSrc` is unavailable
// outside the Tauri webview, so artUrl must degrade to null rather than throw.

import { describe, expect, it } from "vitest";
import { artUrl } from "./art";

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
