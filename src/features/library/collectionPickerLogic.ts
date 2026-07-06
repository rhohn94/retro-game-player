// Pure helpers for the detail-page "Add to collection" picker (v0.37 W373;
// docs/design/collections-design.md). Kept React-free so the membership-diff
// and name-validation logic is unit-testable without a DOM, mirroring
// ./filter.ts's split between pure logic and the presentational component.
// Named distinctly from CollectionPicker.tsx (not collectionPicker.ts) since
// macOS's case-insensitive-but-preserving filesystem cannot distinguish the
// two names, which collides their module resolution.

import type { CollectionWithCount } from "../../ipc/collections";

/** Whether `name` is an acceptable new-collection name: non-empty after
 * trimming, and not already used by an existing collection (case-insensitive
 * — SQLite's UNIQUE index on `collections.name` is case-sensitive, but a
 * user-facing duplicate check should not let "RPGs" and "rpgs" both exist
 * silently past the picker). */
export function isValidNewCollectionName(name: string, existing: readonly CollectionWithCount[]): boolean {
  const trimmed = name.trim();
  if (trimmed === "") return false;
  const lower = trimmed.toLowerCase();
  return !existing.some((c) => c.name.toLowerCase() === lower);
}

/** Sort collections for the picker list: alphabetical by name, matching the
 * backend's `list_collections` ordering (case-insensitive) so the picker
 * never visibly re-shuffles after a round-trip. */
export function sortCollectionsForPicker(
  collections: readonly CollectionWithCount[],
): CollectionWithCount[] {
  return [...collections].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
