// useDebouncedValue — hold a value until it has been stable for `delayMs`
// (v0.26 W261). The TV hero crossfades to the FOCUSED game's key art "on focus
// settle" (tv-mode-design.md §Design "Hero": "crossfade ≤300ms on focus settle
// debounced ~150ms"): while the user sweeps left/right across a rail the focus
// changes every few frames, and we do NOT want the expensive full-bleed art
// swap to fire on each intermediate tile — only once the user pauses. Debouncing
// the game handed to the hero delivers exactly that: the hero settles ~150ms
// after motion stops.

import { useEffect, useState } from "react";

/**
 * Returns `value` delayed until it has stopped changing for `delayMs`. Rapid
 * successive changes collapse to a single settled emission (the last value).
 * The first value is emitted immediately-then-confirmed on the leading render,
 * so an initial mount doesn't wait a full debounce for its first paint.
 *
 * @param value    the live, possibly-rapidly-changing value.
 * @param delayMs  quiet period (ms) the value must hold before it is emitted.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState<T>(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
