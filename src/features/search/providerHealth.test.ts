import { describe, expect, it } from "vitest";
import {
  healthBadgeLabel,
  isUnhealthyProvider,
  providerHealth,
} from "./providerHealth";
import type { ProviderResults } from "../../ipc/search";

function group(partial: Partial<ProviderResults>): ProviderResults {
  return {
    providerId: 1,
    providerName: "Test",
    searchUrl: "https://example.com",
    directDownload: false,
    priority: 10,
    items: [],
    error: null,
    ...partial,
  };
}

describe("providerHealth", () => {
  it("treats captcha/js_shell/empty/error as unhealthy", () => {
    expect(isUnhealthyProvider(group({ health: "captcha" }))).toBe(true);
    expect(isUnhealthyProvider(group({ health: "js_shell" }))).toBe(true);
    expect(isUnhealthyProvider(group({ health: "empty" }))).toBe(true);
    expect(isUnhealthyProvider(group({ health: "error", error: "fail" }))).toBe(
      true,
    );
    expect(
      isUnhealthyProvider(
        group({
          health: "ok",
          items: [{ title: "Game", url: "https://x/g" }],
        }),
      ),
    ).toBe(false);
  });

  it("badge labels for unhealthy groups", () => {
    expect(healthBadgeLabel(group({ health: "captcha" }))).toBe("captcha");
    expect(healthBadgeLabel(group({ health: "js_shell" }))).toBe("JS only");
    expect(healthBadgeLabel(group({ health: "ok", items: [{ title: "A", url: "u" }] }))).toBeNull();
  });

  it("infers empty when no items and no health", () => {
    expect(providerHealth(group({}))).toBe("empty");
  });
});
