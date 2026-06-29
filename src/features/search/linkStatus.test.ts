/**
 * Unit tests for the v0.19 "Reach" link-liveness display helpers — the pure
 * status → indicator mapping and the url → state lookup map. Framework-free.
 */
import { describe, it, expect } from "vitest";
import { statusIndicator, buildStatusMap } from "./linkStatus";
import type { LinkStatus } from "../../ipc/search";

describe("statusIndicator", () => {
  it("maps each state to a distinct colour token", () => {
    expect(statusIndicator("alive").color).toBe("var(--aura-success)");
    expect(statusIndicator("dead").color).toBe("var(--aura-error)");
    expect(statusIndicator("unknown").color).toBe("var(--aura-on-surface-muted)");
  });

  it("provides a human label for every state", () => {
    for (const state of ["alive", "dead", "unknown"] as const) {
      expect(statusIndicator(state).label.length).toBeGreaterThan(0);
      expect(statusIndicator(state).symbol).toBe("●");
    }
  });
});

describe("buildStatusMap", () => {
  it("indexes statuses by url for O(1) lookup", () => {
    const statuses: LinkStatus[] = [
      { url: "https://a/1", state: "alive" },
      { url: "https://a/2", state: "dead" },
      { url: "https://a/3", state: "unknown" },
    ];
    const map = buildStatusMap(statuses);
    expect(map.get("https://a/1")).toBe("alive");
    expect(map.get("https://a/2")).toBe("dead");
    expect(map.get("https://a/3")).toBe("unknown");
    expect(map.get("https://a/missing")).toBeUndefined();
  });

  it("returns an empty map for no statuses", () => {
    expect(buildStatusMap([]).size).toBe(0);
  });

  it("keeps the last verdict when a url is probed twice", () => {
    const map = buildStatusMap([
      { url: "https://a/1", state: "unknown" },
      { url: "https://a/1", state: "alive" },
    ]);
    expect(map.get("https://a/1")).toBe("alive");
  });
});
