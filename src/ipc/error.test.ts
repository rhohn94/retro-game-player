// Unit tests for the AppError decode/guard logic — the error-decoding seam the
// invoke wrapper relies on.
import { describe, expect, it } from "vitest";
import { decodeAppError, isAppError } from "./error";

describe("isAppError", () => {
  it("accepts a well-formed AppError", () => {
    expect(isAppError({ kind: "not_found", detail: "game 7" })).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(isAppError({ kind: "boom", detail: "x" })).toBe(false);
  });

  it("rejects non-objects and missing fields", () => {
    expect(isAppError("io")).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError({ kind: "io" })).toBe(false);
  });
});

describe("decodeAppError", () => {
  it("passes a typed AppError through unchanged", () => {
    const err = { kind: "db", detail: "locked" } as const;
    expect(decodeAppError(err)).toEqual(err);
  });

  it("wraps a bare string as internal", () => {
    expect(decodeAppError("kaboom")).toEqual({
      kind: "internal",
      detail: "kaboom",
    });
  });

  it("wraps an Error instance as internal using its message", () => {
    expect(decodeAppError(new Error("transport down"))).toEqual({
      kind: "internal",
      detail: "transport down",
    });
  });
});
