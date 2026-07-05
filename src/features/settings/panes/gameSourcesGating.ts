// Pure gating/validation helpers for GameSourcesPane (v0.31 W313; extracted
// standalone in W324 so gameSourcesGating.test.ts exercises the real logic
// instead of a hand-maintained mirror; `manualTargetLabel` joined this file in
// W366 when ManualEntrySection.tsx was split out of GameSourcesPane). No
// React, no Tauri IPC — safe to unit-test directly.

import type { ManualTarget } from "../../../ipc/sources";

/** A checklist row pairing an arbitrary item with its checked state. */
export interface ChecklistRow<T> {
  item: T;
  checked: boolean;
}

/** The app-shortlist confirm gate: only checked rows are confirmed. */
export function selectChecked<T>(rows: ChecklistRow<T>[]): T[] {
  return rows.filter((r) => r.checked).map((r) => r.item);
}

/** Manual-entry name validation: a non-blank name is required. */
export function manualNameError(name: string): string | null {
  if (name.trim().length === 0) return "Name is required.";
  return null;
}

/** Manual-entry target validation: an app or executable must be chosen. */
export function manualTargetError(target: unknown): string | null {
  if (!target) return "Choose an app or executable.";
  return null;
}

/** The manual target picker's button label: the target's basename, or a
 * prompt when nothing has been chosen yet. */
export function manualTargetLabel(target: ManualTarget | null): string {
  if (!target) return "Choose target…";
  const path = target.kind === "app" ? target.bundlePath : target.program;
  return path.split("/").pop() ?? path;
}
