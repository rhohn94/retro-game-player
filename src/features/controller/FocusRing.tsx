// FocusRing (W14, harmony-ux-design.md §0). A brand-cyan ring drawn around the
// focused element. Components wrap a focusable child and pass `focused`; the ring
// is a CSS box-shadow + outline so it never affects layout. Spring motion (the
// ring "springing" between targets, §0) is delegated to the consumer via
// framer-motion `layout` where used; this primitive just renders the ring style.

import type { CSSProperties, ReactNode } from "react";

/** The focus-ring visual style, applied to a wrapper around the focused child. */
export function focusRingStyle(focused: boolean): CSSProperties {
  return {
    borderRadius: 12,
    outline: focused ? "2px solid var(--aura-focus)" : "2px solid transparent",
    outlineOffset: 2,
    boxShadow: focused ? "0 0 0 4px color-mix(in oklch, var(--aura-focus) 35%, transparent)" : "none",
    transition:
      "outline-color var(--harmony-dur-fast) var(--harmony-ease-out), " +
      "box-shadow var(--harmony-dur-fast) var(--harmony-ease-out)",
  };
}

/** Convenience wrapper that draws the focus ring around its children. */
export function FocusRing({ focused, children }: { focused: boolean; children: ReactNode }) {
  return <div style={focusRingStyle(focused)}>{children}</div>;
}
