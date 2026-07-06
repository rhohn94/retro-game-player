// Unit tests for the pure collection-picker helpers (v0.37 W373).

import { describe, it, expect } from "vitest";
import { isValidNewCollectionName, sortCollectionsForPicker } from "./collectionPickerLogic";
import type { CollectionWithCount } from "../../ipc/collections";

function collection(id: number, name: string, gameCount = 0): CollectionWithCount {
  return { id, name, createdAt: id, sort: 0, gameCount };
}

describe("isValidNewCollectionName", () => {
  it("rejects an empty or whitespace-only name", () => {
    expect(isValidNewCollectionName("", [])).toBe(false);
    expect(isValidNewCollectionName("   ", [])).toBe(false);
  });

  it("accepts a non-empty name with no existing collision", () => {
    expect(isValidNewCollectionName("Couch co-op", [])).toBe(true);
  });

  it("rejects a name that collides case-insensitively with an existing collection", () => {
    const existing = [collection(1, "RPGs")];
    expect(isValidNewCollectionName("rpgs", existing)).toBe(false);
    expect(isValidNewCollectionName("RPGS", existing)).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    const existing = [collection(1, "Kids")];
    expect(isValidNewCollectionName("  Kids  ", existing)).toBe(false);
    expect(isValidNewCollectionName("  New Shelf  ", existing)).toBe(true);
  });
});

describe("sortCollectionsForPicker", () => {
  it("sorts alphabetically, case-insensitively", () => {
    const input = [collection(1, "rpgs"), collection(2, "Couch co-op"), collection(3, "Kids")];
    const sorted = sortCollectionsForPicker(input);
    expect(sorted.map((c) => c.name)).toEqual(["Couch co-op", "Kids", "rpgs"]);
  });

  it("does not mutate the input array", () => {
    const input = [collection(1, "b"), collection(2, "a")];
    const copy = [...input];
    sortCollectionsForPicker(input);
    expect(input).toEqual(copy);
  });
});
