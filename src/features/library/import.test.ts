/**
 * Unit tests for the library import helpers (W367 test depth, v0.36):
 * pickRomFiles (native picker wrapper), summarizeImport (status line), and
 * runImport (import + fire-and-forget enrichment). The IPC boundary
 * (openFileDialog / importGames / enrichGameMetadata) is mocked so this runs
 * framework-free in node, mirroring src/ipc/swallow.test.ts and
 * src/features/play/playSession.test.ts's vi.mock + dynamic-import pattern.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { clearRecordedFrontendErrors, getRecordedFrontendErrors } from "../../telemetry/errorTelemetry";
import type { ImportItem } from "../../ipc/commands";

const openFileDialog = vi.fn();
const importGames = vi.fn();
const enrichGameMetadata = vi.fn();

vi.mock("../../ipc/dialog", () => ({
  openFileDialog: (...args: unknown[]) => openFileDialog(...args),
}));

vi.mock("../../ipc/commands", () => ({
  importGames: (...args: unknown[]) => importGames(...args),
  enrichGameMetadata: (...args: unknown[]) => enrichGameMetadata(...args),
}));

const { pickRomFiles, summarizeImport, runImport, ROM_EXTENSIONS } = await import("./import");

beforeEach(() => {
  openFileDialog.mockReset();
  importGames.mockReset();
  enrichGameMetadata.mockReset();
  clearRecordedFrontendErrors();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function item(over: Partial<ImportItem>): ImportItem {
  return { source: "/roms/a.nes", status: "imported", game: null, message: null, ...over };
}

describe("pickRomFiles", () => {
  it("returns the chosen paths as an array when multiple files are picked", async () => {
    openFileDialog.mockResolvedValue(["/roms/a.nes", "/roms/b.snes"]);
    await expect(pickRomFiles()).resolves.toEqual(["/roms/a.nes", "/roms/b.snes"]);
    expect(openFileDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: true,
        filters: [{ name: "ROMs", extensions: ROM_EXTENSIONS }],
      }),
    );
  });

  it("wraps a single selected path into a one-element array", async () => {
    openFileDialog.mockResolvedValue("/roms/a.nes");
    await expect(pickRomFiles()).resolves.toEqual(["/roms/a.nes"]);
  });

  it("returns an empty array when the user cancels (falsy result)", async () => {
    openFileDialog.mockResolvedValue(null);
    await expect(pickRomFiles()).resolves.toEqual([]);
  });

  it("returns an empty array instead of throwing when the dialog call fails", async () => {
    openFileDialog.mockRejectedValue(new Error("no webview"));
    await expect(pickRomFiles()).resolves.toEqual([]);
  });
});

describe("summarizeImport", () => {
  it("reports nothing to import for an empty batch", () => {
    expect(summarizeImport([])).toBe("Nothing to import");
  });

  it("summarizes a single status", () => {
    expect(summarizeImport([item({ status: "imported" })])).toBe("1 imported");
  });

  it("joins every present status count in the documented order", () => {
    const items = [
      item({ status: "imported" }),
      item({ status: "imported" }),
      item({ status: "exists" }),
      item({ status: "unsupported" }),
      item({ status: "error" }),
    ];
    expect(summarizeImport(items)).toBe(
      "2 imported · 1 already in library · 1 unsupported · 1 failed",
    );
  });
});

describe("runImport", () => {
  it("returns an empty array without calling importGames for an empty path list", async () => {
    const results = await runImport([]);
    expect(results).toEqual([]);
    expect(importGames).not.toHaveBeenCalled();
  });

  it("imports the given paths and returns the per-file results immediately", async () => {
    const results: ImportItem[] = [item({ source: "/roms/a.nes", status: "imported", game: { id: 1 } as never })];
    importGames.mockResolvedValue(results);
    enrichGameMetadata.mockResolvedValue({ id: 1 });

    const out = await runImport(["/roms/a.nes"]);
    expect(out).toBe(results);
    expect(importGames).toHaveBeenCalledWith(["/roms/a.nes"]);
  });

  it("fires onEnriched once enrichment for every imported game has settled", async () => {
    const results: ImportItem[] = [
      item({ source: "/roms/a.nes", status: "imported", game: { id: 1 } as never }),
      item({ source: "/roms/b.nes", status: "imported", game: { id: 2 } as never }),
      item({ source: "/roms/bad.txt", status: "unsupported", game: null }),
    ];
    importGames.mockResolvedValue(results);
    enrichGameMetadata.mockResolvedValue({});

    const onEnriched = vi.fn();
    await runImport(["/roms/a.nes", "/roms/b.nes", "/roms/bad.txt"], onEnriched);

    expect(enrichGameMetadata).toHaveBeenCalledTimes(2);
    expect(enrichGameMetadata).toHaveBeenCalledWith(1);
    expect(enrichGameMetadata).toHaveBeenCalledWith(2);
    expect(onEnriched).not.toHaveBeenCalled(); // enrichment is fire-and-forget

    await vi.waitFor(() => expect(onEnriched).toHaveBeenCalledTimes(1));
  });

  it("does not call onEnriched when nothing was imported", async () => {
    importGames.mockResolvedValue([item({ status: "unsupported", game: null })]);
    const onEnriched = vi.fn();
    await runImport(["/roms/bad.txt"], onEnriched);
    expect(enrichGameMetadata).not.toHaveBeenCalled();
    // Give any stray microtask a chance to run before asserting the negative.
    await Promise.resolve();
    expect(onEnriched).not.toHaveBeenCalled();
  });

  it("swallows an enrichment failure instead of rejecting the batch", async () => {
    importGames.mockResolvedValue([item({ source: "/roms/a.nes", status: "imported", game: { id: 1 } as never })]);
    enrichGameMetadata.mockRejectedValue({ kind: "network", detail: "cdn unreachable" });

    const onEnriched = vi.fn();
    await runImport(["/roms/a.nes"], onEnriched);
    await vi.waitFor(() => expect(onEnriched).toHaveBeenCalledTimes(1));

    const [record] = getRecordedFrontendErrors();
    expect(record).toMatchObject({
      source: "swallow:runImport.enrichGameMetadata",
      message: "cdn unreachable",
    });
  });
});
