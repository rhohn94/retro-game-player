// useFetchOnMount — shared "load a list on mount/dep-change, expose
// loading + fetchError" scaffold, extracted in W366 from the identical
// cancelled-ref/loading/fetchError blocks duplicated in
// `features/core-options/useCoreOptions.ts` and `features/cores/useCores.ts`.
// Layers on top of `useCancellableEffect` — this hook owns only the
// loading/error bookkeeping; callers still own their own result state so
// each can shape its success handler differently (e.g. grouping cores by
// system) without this hook knowing about that shape.

import { useState, type DependencyList } from "react";
import { useCancellableEffect } from "./useCancellableEffect";

export interface UseFetchOnMountResult {
  /** True while the fetch is in flight (including on every dep re-fetch). */
  loading: boolean;
  /** The most recent fetch's error message, or `null` when absent/still loading. */
  fetchError: string | null;
}

/**
 * Runs `fetch()` once per `deps` change. On success, calls `onSuccess` with the
 * resolved value (skipped if a newer dep change has already superseded this
 * call); on failure, converts the error via `errorMessage` and exposes it as
 * `fetchError`. Manages `loading` automatically around both outcomes.
 */
export function useFetchOnMount<T>(
  fetch: () => Promise<T>,
  onSuccess: (value: T) => void,
  errorMessage: (err: unknown) => string,
  deps: DependencyList,
): UseFetchOnMountResult {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useCancellableEffect((isCancelled) => {
    setLoading(true);
    setFetchError(null);

    fetch()
      .then((value) => {
        if (isCancelled()) return;
        onSuccess(value);
      })
      .catch((err: unknown) => {
        if (isCancelled()) return;
        setFetchError(errorMessage(err));
      })
      .finally(() => {
        if (!isCancelled()) setLoading(false);
      });
  }, deps); // deps is the caller's own dependency list, forwarded as-is.

  return { loading, fetchError };
}
