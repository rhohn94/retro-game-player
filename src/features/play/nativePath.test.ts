import { describe, expect, it } from "vitest";
import { NATIVE_SYSTEM, isNativePathEligible } from "./nativePath";

describe("isNativePathEligible (W273 native-path gate)", () => {
  it("is eligible only for the native system with the opt-in enabled", () => {
    expect(isNativePathEligible(NATIVE_SYSTEM, true)).toBe(true);
  });

  it("is never eligible with the native-play opt-in off", () => {
    expect(isNativePathEligible(NATIVE_SYSTEM, false)).toBe(false);
  });

  it("is never eligible for a non-native system, regardless of the flag", () => {
    expect(isNativePathEligible("snes", true)).toBe(false);
    expect(isNativePathEligible("snes", false)).toBe(false);
    expect(isNativePathEligible("gba", true)).toBe(false);
  });
});
