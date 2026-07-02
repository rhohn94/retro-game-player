import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeDegradation,
  recordDegradation,
  resetDegradationsForTest,
} from "./degradation";

describe("degradation", () => {
  beforeEach(() => {
    resetDegradationsForTest();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("describes every cause with a message and a fix hint", () => {
    for (const cause of ["native-start-failed", "play-server-unavailable"] as const) {
      const n = describeDegradation(cause);
      expect(n.message.length).toBeGreaterThan(0);
      expect(n.hint.length).toBeGreaterThan(0);
    }
  });

  it("shows a cause once per session but always logs", () => {
    expect(recordDegradation("native-start-failed")).toBe(true);
    expect(recordDegradation("native-start-failed")).toBe(false);
    expect(recordDegradation("play-server-unavailable", "bind refused")).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});
