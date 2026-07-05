import { describe, expect, it } from "vitest";
import {
  describeCoreSize,
  externalOnlyMessage,
  inPageAvailability,
  systemLabel,
} from "./inPageAvailability";
import type { InPageCore } from "../../ipc/inpage-cores";

const CORES: InPageCore[] = [
  { core: "snes9x", systems: ["snes"], installed: true, sizeBytes: 1_093_765 },
  { core: "genesis_plus_gx", systems: ["genesis", "mastersystem"], installed: false, sizeBytes: 1_203_661 },
];

describe("inPageAvailability", () => {
  it("is none for systems without any in-page core", () => {
    expect(inPageAvailability("dreamcast", CORES)).toEqual({ kind: "none" });
  });

  it("is none for GameCube/Wii (dolphin-libretro is external-launch only, W346)", () => {
    expect(inPageAvailability("gamecube", CORES)).toEqual({ kind: "none" });
    expect(inPageAvailability("wii", CORES)).toEqual({ kind: "none" });
  });

  it("is ready for the embedded NES core regardless of catalog state", () => {
    expect(inPageAvailability("nes", null)).toEqual({ kind: "ready", ejsCore: "nes" });
  });

  it("is ready when the on-demand core is installed", () => {
    expect(inPageAvailability("snes", CORES)).toEqual({ kind: "ready", ejsCore: "snes9x" });
  });

  it("needs a core when the catalog says not installed, carrying the size", () => {
    expect(inPageAvailability("genesis", CORES)).toEqual({
      kind: "needs-core",
      ejsCore: "genesis_plus_gx",
      sizeBytes: 1_203_661,
    });
  });

  it("degrades to needs-core (never a false ready) with no catalog", () => {
    expect(inPageAvailability("snes", null)).toEqual({
      kind: "needs-core",
      ejsCore: "snes9x",
      sizeBytes: 0,
    });
  });
});

describe("describeCoreSize", () => {
  it("formats bytes as MB and handles unknown sizes", () => {
    expect(describeCoreSize(1_093_765)).toBe("1.0 MB");
    expect(describeCoreSize(1_451_795)).toBe("1.4 MB");
    expect(describeCoreSize(0)).toBe("a small download");
  });
});

describe("systemLabel", () => {
  it("names known systems and falls back to the key", () => {
    expect(systemLabel("snes")).toBe("SNES");
    expect(systemLabel("atari2600")).toBe("Atari 2600");
    expect(systemLabel("gamecube")).toBe("GameCube");
    expect(systemLabel("wii")).toBe("Wii");
    expect(systemLabel("weird")).toBe("weird");
    expect(systemLabel("constructor")).toBe("constructor"); // prototype-safe
  });
});

describe("externalOnlyMessage", () => {
  it("names the actual emulator for a curated external-only system", () => {
    expect(externalOnlyMessage("gamecube")).toBe(
      "GameCube titles launch in RetroArch (Dolphin core) — a separate window opens to play.",
    );
    expect(externalOnlyMessage("wii")).toBe(
      "Wii titles launch in RetroArch (Dolphin core) — a separate window opens to play.",
    );
  });

  it("falls back to generic RetroArch wording with no curated emulator name", () => {
    expect(externalOnlyMessage("dreamcast")).toBe(
      "dreamcast titles launch in RetroArch — a separate window opens to play.",
    );
  });
});
