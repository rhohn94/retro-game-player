// Unit tests for the shared swallow() IPC-failure helper (W360).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecordedFrontendErrors, getRecordedFrontendErrors } from "../telemetry/errorTelemetry";
import { swallow } from "./swallow";

describe("swallow", () => {
  beforeEach(() => {
    clearRecordedFrontendErrors();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("records a typed AppError's detail, context, and default warn severity", () => {
    swallow({ kind: "network", detail: "buildbot unreachable" }, "GameDetailPage.refreshMetadata");

    const [record] = getRecordedFrontendErrors();
    expect(record).toMatchObject({
      source: "swallow:GameDetailPage.refreshMetadata",
      message: "buildbot unreachable",
    });
    expect(record?.detail).toContain("severity=warn");
    expect(record?.detail).toContain("kind=network");
  });

  it("wraps a bare thrown Error via decodeAppError as internal", () => {
    swallow(new Error("transport down"), "TvHome.pollStatus");

    const [record] = getRecordedFrontendErrors();
    expect(record?.message).toBe("transport down");
    expect(record?.detail).toContain("kind=internal");
  });

  it("accepts an explicit severity override", () => {
    swallow("ignored", "NativePlayer.saveSlot", "info");

    const [record] = getRecordedFrontendErrors();
    expect(record?.detail).toContain("severity=info");
  });

  it("does not throw for any input shape", () => {
    expect(() => swallow(undefined, "x")).not.toThrow();
    expect(() => swallow(null, "y")).not.toThrow();
    expect(() => swallow(42, "z")).not.toThrow();
  });
});
