// LoadingState — the shared "rgp-muted" loading-text convention (W226),
// used while an async fetch is in flight and there's nothing to show yet.

import type { ReactNode } from "react";

export function LoadingState({ children }: { children: ReactNode }) {
  return <p className="rgp-muted">{children}</p>;
}
