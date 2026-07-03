// useWindowFocus — the live "does the app window hold focus?" boolean
// (v0.27 W275). Extracted as a shared hook (the useCancellableEffect pattern:
// one impure browser seam, one summary comment) for gates that must stop
// while the app is backgrounded — first consumer: the TV hover-attract dwell,
// which otherwise kept counting behind a Cmd+Tab and booted an audible
// preview while the app wasn't even frontmost (pause-on-blur can't catch a
// session that MOUNTS after the blur already happened).

import { useEffect, useState } from "react";

/**
 * True while the window has focus. Initialised from `document.hasFocus()` so
 * a surface mounted in an already-backgrounded app starts out gated; safe
 * outside a browser (SSR/tests) where it stays true and never subscribes.
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(
    () => typeof document === "undefined" || document.hasFocus(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return focused;
}
