// Pure gating/validation helpers for GameSourcesPane (v0.31 W313; extracted
// standalone in W324 so gameSourcesGating.test.ts exercises the real logic
// instead of a hand-maintained mirror). No React, no Tauri IPC — safe to
// unit-test directly.

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
