// EmptyState — the shared "harmony-muted" empty-state-text convention (W226)
// for a plain "nothing here" message. Composite empty states with extra
// actions (e.g. Library's "no games yet" + buttons) wrap this around just the
// message line rather than reimplementing the text styling.

import type { ReactNode } from "react";

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="harmony-muted">{children}</p>;
}
