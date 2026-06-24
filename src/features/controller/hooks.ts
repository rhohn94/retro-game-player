// Controller hooks (W14). `useController` reads the context (throwing a clear
// error outside the provider); `useFocusable` registers a DOM ref as a spatial-
// nav target and reports whether it currently holds focus. Screens wrap each
// focusable element with `useFocusable` and read `isFocused` to draw the ring.

import { useContext, useEffect, useRef, useState } from "react";
import { ControllerContext, type ControllerContextValue } from "./ControllerProvider";

/** Read the controller context; throws if used outside `<ControllerProvider>`. */
export function useController(): ControllerContextValue {
  const ctx = useContext(ControllerContext);
  if (!ctx) throw new Error("useController must be used within a ControllerProvider");
  return ctx;
}

export interface UseFocusableResult<T extends HTMLElement> {
  /** Attach to the focusable element. */
  ref: React.RefObject<T | null>;
  /** True when this element currently holds controller focus. */
  isFocused: boolean;
  /** Programmatically request focus on this element. */
  focus: () => void;
}

/**
 * Register an element as a spatial-nav focus target. `id` must be stable + unique
 * within the screen. `onActivate` fires when `confirm` is pressed while focused.
 */
export function useFocusable<T extends HTMLElement = HTMLElement>(
  id: string,
  onActivate?: () => void,
): UseFocusableResult<T> {
  const { register, focusedId, setFocus } = useController();
  const ref = useRef<T | null>(null);
  // Keep the latest onActivate without re-registering on every render.
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;
  const [, force] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cleanup = register({ id, el, onActivate: () => activateRef.current?.() });
    force((n) => n + 1); // re-render so initial focus state is reflected
    return cleanup;
  }, [id, register]);

  return {
    ref,
    isFocused: focusedId === id,
    focus: () => setFocus(id),
  };
}
