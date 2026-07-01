// ErrorNotice — the shared `AuraCard class="harmony-notice"` convention (W226)
// for surfacing a failed fetch or action.

import type { ReactNode } from "react";
import { AuraCard } from "@aura/react";

export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <AuraCard class="harmony-notice" role="alert">
      {children}
    </AuraCard>
  );
}
