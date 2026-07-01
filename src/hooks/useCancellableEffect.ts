// useCancellableEffect — the `let cancelled = false; ...; return () => { cancelled
// = true }` guard against a stale async callback writing state after unmount/dep
// change, extracted into one shared hook (v0.22 "Polish" W222). This exact guard
// had drifted into 10+ independent hand-rolled copies across the frontend
// (GameDetailPage, ConsoleDetailPage, LibraryPage, ConsolesPage, and more) — a
// textbook DRY violation per docs/coding-standards.md.

import { useEffect, type DependencyList } from "react";

/**
 * Runs `effect` once per `deps` change, passing an `isCancelled()` guard the
 * effect calls before any state update that follows an `await`/`.then()` — so
 * async work started before the next dep change (or unmount) skips writing to
 * a component that has moved on, instead of leaking into a stale closure.
 *
 * `effect` may optionally return its own cleanup function (e.g. `clearTimeout`)
 * for effects that need more than the cancellation flag; it runs alongside the
 * flag flip, in the same cleanup pass.
 */
export function useCancellableEffect(
  effect: (isCancelled: () => boolean) => void | (() => void),
  deps: DependencyList,
): void {
  useEffect(() => {
    let cancelled = false;
    const extraCleanup = effect(() => cancelled);
    return () => {
      cancelled = true;
      extraCleanup?.();
    };
  }, deps); // deps is the caller's own dependency list, forwarded as-is.
}
