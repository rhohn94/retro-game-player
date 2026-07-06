import { describe, expect, it } from "vitest";
import { resolveAttractPreviewPath } from "./attractPreviewPath";
import { NATIVE_SYSTEM } from "./nativePath";
import type { NativeCapabilities } from "./nativePath";
import type { InPageCore } from "../../ipc/inpage-cores";

function capabilities(rows: ReadonlyArray<[string, boolean]>): NativeCapabilities {
  return new Map(
    rows.map(([system, coreInstalled]) => [
      system,
      { system, coreId: `${system}-core`, coreInstalled },
    ]),
  );
}

const CORES: InPageCore[] = [
  { core: "snes9x", systems: ["snes"], installed: true, sizeBytes: 1_093_765 },
  { core: "genesis_plus_gx", systems: ["genesis", "mastersystem"], installed: false, sizeBytes: 1_203_661 },
];

describe("resolveAttractPreviewPath (W376 EJS-scope extension)", () => {
  it("prefers native when the system is native-path eligible", () => {
    const caps = capabilities([[NATIVE_SYSTEM, true]]);
    expect(resolveAttractPreviewPath(NATIVE_SYSTEM, true, caps, null)).toEqual({ kind: "native" });
  });

  it("falls back to EJS when native is ineligible but an in-page core is ready", () => {
    const caps = capabilities([]);
    expect(resolveAttractPreviewPath("snes", true, caps, CORES)).toEqual({
      kind: "ejs",
      ejsCore: "snes9x",
    });
  });

  it("prefers native even when an EJS core also exists for the same system", () => {
    const caps = capabilities([[NATIVE_SYSTEM, true]]);
    // NES is embedded in-page too, but native-eligible NES must win — a
    // native preview is structurally pure, so it's the stronger guarantee.
    expect(resolveAttractPreviewPath(NATIVE_SYSTEM, true, caps, null)).toEqual({ kind: "native" });
  });

  it("is ready via the embedded NES EJS core when native is disabled", () => {
    const caps = capabilities([[NATIVE_SYSTEM, false]]);
    expect(resolveAttractPreviewPath(NATIVE_SYSTEM, true, caps, null)).toEqual({
      kind: "ejs",
      ejsCore: "nes",
    });
  });

  it("is none when the EJS core isn't installed yet (needs-core, never a false ready)", () => {
    const caps = capabilities([]);
    expect(resolveAttractPreviewPath("genesis", true, caps, CORES)).toEqual({ kind: "none" });
  });

  it("is none when the in-page catalog hasn't loaded yet (null degrades safely)", () => {
    const caps = capabilities([]);
    expect(resolveAttractPreviewPath("snes", true, caps, null)).toEqual({ kind: "none" });
  });

  it("is none for an external-only system with no native or in-page path at all", () => {
    const caps = capabilities([]);
    expect(resolveAttractPreviewPath("gamecube", true, caps, CORES)).toEqual({ kind: "none" });
    expect(resolveAttractPreviewPath("wii", true, caps, CORES)).toEqual({ kind: "none" });
  });

  it("is none for a non-ROM game with no system at all (caller passes an empty key)", () => {
    const caps = capabilities([]);
    expect(resolveAttractPreviewPath("", true, caps, CORES)).toEqual({ kind: "none" });
  });
});
