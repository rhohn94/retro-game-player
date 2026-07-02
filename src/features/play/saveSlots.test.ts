import { describe, expect, it } from "vitest";
import { continueSlot, slotRows } from "./saveSlots";
import type { GameSaves } from "../../ipc/native-play";

const saves: GameSaves = {
  hasSram: true,
  slots: [
    { slot: "2", playPath: "native", createdAt: 1_800_000_000 },
    { slot: "3", playPath: "ejs", createdAt: 1_800_000_100 },
    { slot: "auto", playPath: "native", createdAt: 1_800_000_200 },
  ],
};

describe("slotRows", () => {
  it("labels empty slots and never lists the auto slot", () => {
    const rows = slotRows(null, "native", "save");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.slot)).toEqual(["1", "2", "3", "4"]);
    expect(rows[0].label).toBe("Slot 1 — empty");
    expect(rows.every((r) => !r.occupied)).toBe(true);
  });

  it("marks occupied slots with a timestamp", () => {
    const rows = slotRows(saves, "native", "save");
    expect(rows[1].occupied).toBe(true);
    expect(rows[1].label).toContain("Slot 2 · ");
    expect(rows[3].occupied).toBe(false);
  });

  it("flags the other path's slots as foreign in load mode only", () => {
    const load = slotRows(saves, "native", "load");
    expect(load[2].foreign).toBe(true);
    expect(load[2].label).toContain("(other player)");
    const save = slotRows(saves, "native", "save");
    expect(save[2].foreign).toBe(true);
    expect(save[2].label).not.toContain("(other player)");
  });
});

describe("continueSlot", () => {
  it("picks the newest state written by the active path", () => {
    expect(continueSlot(saves, "native")?.slot).toBe("auto");
    expect(continueSlot(saves, "ejs")?.slot).toBe("3");
  });

  it("returns null when the active path has nothing restorable", () => {
    expect(continueSlot(null, "native")).toBeNull();
    expect(continueSlot({ hasSram: false, slots: [] }, "ejs")).toBeNull();
  });
});
