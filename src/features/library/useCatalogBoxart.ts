// Resolve box art for a Global Catalog title (system + name, no game id).
import { useState } from "react";
import { fetchBoxartForTitle, getCachedArtForTitle } from "../../ipc/metadata";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { artUrl } from "./art";

/**
 * @param allowFetch when true, hit the CDN if local cache is empty (detail).
 *                   Grid should pass false to avoid art storms.
 */
export function useCatalogBoxart(
  system: string | null | undefined,
  title: string | null | undefined,
  allowFetch = false,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useCancellableEffect(
    (isCancelled) => {
      setUrl(null);
      if (!system || !title) return;
      void (async () => {
        try {
          const cached = await getCachedArtForTitle(system, title);
          if (isCancelled()) return;
          if (cached) {
            setUrl(artUrl(cached));
            return;
          }
          if (!allowFetch) return;
          const fetched = await fetchBoxartForTitle(system, title);
          if (!isCancelled() && fetched) setUrl(artUrl(fetched));
        } catch {
          if (!isCancelled()) setUrl(null);
        }
      })();
    },
    [system, title, allowFetch],
  );

  return url;
}
