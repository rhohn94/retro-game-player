// LoadingState — the shared "harmony-muted" loading-text convention (W226),
// used while an async fetch is in flight and there's nothing to show yet.

import type { ReactNode } from "react";

export function LoadingState({ children }: { children: ReactNode }) {
  return <p className="harmony-muted">{children}</p>;
}
