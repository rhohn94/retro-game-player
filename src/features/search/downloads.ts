/**
 * Search-provider kind helpers (v0.11 "Quarry").
 *
 * Providers come in two kinds: "reference" (metadata/info sites, seeded in v0.6)
 * and "download" (links to legal homes for downloadable content, seeded in
 * v0.11). These pure helpers let the Search UI label and group providers and
 * their results by kind. They never fetch anything — the no-auto-download
 * contract (file-search-design.md §2) is upheld entirely by constructing links.
 */

/** The provider-kind discriminator. Unknown/missing values read as reference. */
export const DOWNLOAD_KIND = "download";

/** A minimal provider shape these helpers operate on. */
export interface KindedProvider {
  kind: string;
}

/** True when the provider links to downloadable content (vs. reference info). */
export function isDownloadProvider(p: KindedProvider): boolean {
  return p.kind === DOWNLOAD_KIND;
}

/** Split providers into download- and reference-kind, preserving order. */
export function partitionByKind<T extends KindedProvider>(
  providers: T[],
): { downloads: T[]; reference: T[] } {
  const downloads: T[] = [];
  const reference: T[] = [];
  for (const p of providers) {
    (isDownloadProvider(p) ? downloads : reference).push(p);
  }
  return { downloads, reference };
}

/** True when at least one download-kind provider is present. */
export function hasDownloadProviders(providers: KindedProvider[]): boolean {
  return providers.some(isDownloadProvider);
}
