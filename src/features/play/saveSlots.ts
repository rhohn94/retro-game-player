// saveSlots — pure helpers for the overlay's save/load slot picker (v0.23
// W232). Merges a game's on-disk save inventory (`list_game_saves`) into
// labelled slot rows for the picker; path-aware because a state written by
// one play path cannot be loaded by the other (save-persistence-design.md §1).

import type { GameSaves, SaveSlot, SaveSlotInfo } from "../../ipc/native-play";

/** The manual slots the picker offers, in display order. */
export const PICKER_SLOTS: SaveSlot[] = ["1", "2", "3", "4"];

/** One row of the slot picker. */
export interface SlotRow {
  slot: SaveSlot;
  /** e.g. "Slot 2 — empty" or "Slot 2 · 7/1/2026, 8:15 PM". */
  label: string;
  /** A recorded state exists in this slot. */
  occupied: boolean;
  /** Occupied by the *other* play path — visible but not loadable here. */
  foreign: boolean;
}

function findSlot(saves: GameSaves | null, slot: string): SaveSlotInfo | undefined {
  return saves?.slots.find((s) => s.slot === slot);
}

/** Formats a unix-seconds timestamp for slot labels (locale-aware). */
export function slotTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Builds the picker rows for one mode. In "load" mode a slot written by the
 * other path is marked foreign (shown, labelled, not loadable); in "save"
 * mode every slot is writable (saving overwrites regardless of origin).
 */
export function slotRows(
  saves: GameSaves | null,
  activePath: "native" | "ejs",
  mode: "save" | "load",
): SlotRow[] {
  return PICKER_SLOTS.map((slot) => {
    const info = findSlot(saves, slot);
    if (!info) {
      return { slot, label: `Slot ${slot} — empty`, occupied: false, foreign: false };
    }
    const foreign = info.playPath !== activePath;
    const suffix = foreign && mode === "load" ? " (other player)" : "";
    return {
      slot,
      label: `Slot ${slot} · ${slotTimestamp(info.createdAt)}${suffix}`,
      occupied: true,
      foreign,
    };
  });
}

/** The newest state loadable by `activePath` (auto or manual) — the
 * "Continue" target — or null when nothing is restorable. */
export function continueSlot(
  saves: GameSaves | null,
  activePath: "native" | "ejs",
): SaveSlotInfo | null {
  const candidates = (saves?.slots ?? []).filter((s) => s.playPath === activePath);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
}
