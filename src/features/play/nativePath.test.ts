import { describe, expect, it } from "vitest";
import { NATIVE_SYSTEM, isNativePathEligible } from "./nativePath";
import type { NativeCapabilities } from "./nativePath";

/** Builds a capability map the way `fetchNativeCapabilities` would, from a
 * plain list of `[system, coreInstalled]` pairs — kept local to this test
 * file since production code only ever builds the map from the IPC
 * response. */
function capabilities(rows: ReadonlyArray<[string, boolean]>): NativeCapabilities {
  return new Map(
    rows.map(([system, coreInstalled]) => [
      system,
      { system, coreId: `${system}-core`, coreInstalled },
    ]),
  );
}

describe("isNativePathEligible (W273 native-path gate, W340 table-driven)", () => {
  it("is eligible for a table system with an installed core and the opt-in enabled", () => {
    const caps = capabilities([[NATIVE_SYSTEM, true]]);
    expect(isNativePathEligible(NATIVE_SYSTEM, true, caps)).toBe(true);
  });

  it("is never eligible with the native-play opt-in off, even with an installed core", () => {
    const caps = capabilities([[NATIVE_SYSTEM, true]]);
    expect(isNativePathEligible(NATIVE_SYSTEM, false, caps)).toBe(false);
  });

  it("is never eligible for a system absent from the capability table", () => {
    const caps = capabilities([[NATIVE_SYSTEM, true]]);
    expect(isNativePathEligible("snes", true, caps)).toBe(false);
    expect(isNativePathEligible("gba", true, caps)).toBe(false);
  });

  it("is never eligible for a table system whose core isn't installed yet", () => {
    const caps = capabilities([[NATIVE_SYSTEM, false]]);
    expect(isNativePathEligible(NATIVE_SYSTEM, true, caps)).toBe(false);
  });

  it("is never eligible against an empty capability table (fetch failure degradation)", () => {
    expect(isNativePathEligible(NATIVE_SYSTEM, true, new Map())).toBe(false);
  });

  it("a second table row is eligible independently of the first (multi-system table)", () => {
    const caps = capabilities([
      [NATIVE_SYSTEM, true],
      ["snes", true],
    ]);
    expect(isNativePathEligible("snes", true, caps)).toBe(true);
    expect(isNativePathEligible(NATIVE_SYSTEM, true, caps)).toBe(true);
  });
});
