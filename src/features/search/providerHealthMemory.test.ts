import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderResults } from "../../ipc/search";
import {
  clearHealthMemory,
  HEALTH_FAIL_THRESHOLD,
  isSoftSkipped,
  listSoftSkippedProviderIds,
  recordSearchHealth,
  resumeProvider,
} from "./providerHealthMemory";

function group(
  id: number,
  health: string,
  items: { title: string; url: string }[] = []
): ProviderResults {
  return {
    providerId: id,
    providerName: `P${id}`,
    searchUrl: "https://example.com",
    directDownload: false,
    priority: 30,
    items,
    error: health === "error" ? "fail" : null,
    health,
  };
}

describe("providerHealthMemory", () => {
  beforeEach(() => {
    clearHealthMemory();
  });
  afterEach(() => {
    clearHealthMemory();
  });

  it("soft-skips after N consecutive hard failures", () => {
    for (let i = 0; i < HEALTH_FAIL_THRESHOLD; i++) {
      recordSearchHealth([group(1, "captcha")]);
    }
    expect(isSoftSkipped(1)).toBe(true);
    expect(listSoftSkippedProviderIds()).toEqual([1]);
  });

  it("does not soft-skip on empty results alone", () => {
    for (let i = 0; i < HEALTH_FAIL_THRESHOLD + 2; i++) {
      recordSearchHealth([group(2, "empty")]);
    }
    expect(isSoftSkipped(2)).toBe(false);
  });

  it("resets streak on ok", () => {
    for (let i = 0; i < HEALTH_FAIL_THRESHOLD - 1; i++) {
      recordSearchHealth([group(3, "error")]);
    }
    recordSearchHealth([
      group(3, "ok", [{ title: "Game", url: "https://x.com/g" }]),
    ]);
    recordSearchHealth([group(3, "error")]);
    expect(isSoftSkipped(3)).toBe(false);
  });

  it("resume clears soft-skip", () => {
    for (let i = 0; i < HEALTH_FAIL_THRESHOLD; i++) {
      recordSearchHealth([group(4, "js_shell")]);
    }
    expect(isSoftSkipped(4)).toBe(true);
    resumeProvider(4);
    expect(isSoftSkipped(4)).toBe(false);
  });
});
