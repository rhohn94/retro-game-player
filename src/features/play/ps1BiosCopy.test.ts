import { describe, expect, it } from "vitest";
import { PS1_BIOS_NOTICE, shouldShowPs1BiosNotice } from "./ps1BiosCopy";

describe("shouldShowPs1BiosNotice (W344 PS1 HLE-BIOS honesty notice)", () => {
  it("shows for ps1 once the native path is active", () => {
    expect(shouldShowPs1BiosNotice("ps1", true)).toBe(true);
  });

  it("never shows for ps1 before the native path is active", () => {
    expect(shouldShowPs1BiosNotice("ps1", false)).toBe(false);
  });

  it("never shows for a non-PS1 system, even with the native path active", () => {
    for (const system of ["nes", "snes", "n64", "gba"]) {
      expect(shouldShowPs1BiosNotice(system, true)).toBe(false);
    }
  });
});

describe("PS1_BIOS_NOTICE copy", () => {
  it("mentions the HLE BIOS and where a real BIOS file would go", () => {
    expect(PS1_BIOS_NOTICE.message).toMatch(/HLE/);
    expect(PS1_BIOS_NOTICE.message).toMatch(/BIOS/);
  });

  it("documents the single-disc swap limitation", () => {
    expect(PS1_BIOS_NOTICE.hint).toMatch(/disc 1/);
  });
});
