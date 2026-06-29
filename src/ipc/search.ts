/**
 * File-search provider IPC wrappers (W9 / W17 / v0.16 "Trove").
 *
 * Design contract: v0.16 `runSearch` fetches each provider's public
 * search-results page and returns a PREVIEW of the links it found, grouped by
 * provider. The invariant that matters is unchanged — the backend never
 * downloads the content itself; the caller opens the user's chosen link in the
 * system browser. Ships with an empty user-provider list (seeded providers
 * aside); users add their own manually.
 *
 * Master contract: architecture-design.md §2.5; download-search-design.md
 */

import { invoke } from "./invoke";

// ── DTOs ────────────────────────────────────────────────────────────────────

/** A user-configured search provider. */
export interface SearchProvider {
  id: number;
  name: string;
  /** URL template containing the `{query}` placeholder. */
  urlTemplate: string;
  enabled: boolean;
  /**
   * Category: `"reference"` (metadata/info sites) or `"download"` (links to
   * legal homes for downloadable content). Drives grouping/labeling in the UI.
   * Older rows without the column read as `"reference"`.
   */
  kind: string;
  /**
   * Per-vendor opt-in for the future OPTIONAL direct-download feature (v0.16
   * scaffolding). `false` by default; no direct-download action exists yet.
   */
  directDownload: boolean;
  /**
   * Per-vendor opt-in (v0.18): when `true`, the structured search filters
   * (console, region) are appended to this provider's query before
   * substitution. `false` by default — the bare game name is searched.
   */
  composeFilters: boolean;
}

/**
 * A single scraped preview link from a provider's results page. The user opens
 * `url` in the system browser; Harmony never downloads it.
 */
export interface SearchResultItem {
  /** The scraped anchor text. */
  title: string;
  /** Fully-resolved absolute URL; pass to `openUrl()`. */
  url: string;
}

/**
 * A link's liveness verdict (v0.19). `alive` = the host answered success/
 * redirect; `dead` = a definitive 404/410; `unknown` = blocked, errored, or
 * indeterminate (never claimed dead on a maybe). Mirrors the Rust `LinkState`.
 */
export type LinkState = "alive" | "dead" | "unknown";

/** One probed URL paired with its liveness verdict. Mirrors Rust `LinkStatus`. */
export interface LinkStatus {
  url: string;
  state: LinkState;
}

/**
 * The previewed results for one provider. `searchUrl` is the provider's
 * constructed search-page link (always present, so the UI can offer "open the
 * full results page" even when scraping is empty or fails). `items` are the
 * scraped preview links; `error` is a per-provider fetch/parse failure message.
 */
export interface ProviderResults {
  providerId: number;
  providerName: string;
  searchUrl: string;
  /** Whether this vendor has the future direct-download capability enabled. */
  directDownload: boolean;
  items: SearchResultItem[];
  error: string | null;
}

// ── Typed wrappers ───────────────────────────────────────────────────────────

/** List all configured search providers, ordered by id. */
export function listProviders(): Promise<SearchProvider[]> {
  return invoke<SearchProvider[]>("list_providers");
}

/**
 * Add a new search provider.
 * `urlTemplate` must be non-empty and contain the `{query}` placeholder.
 */
export function addProvider(args: {
  name: string;
  urlTemplate: string;
  directDownload?: boolean;
  composeFilters?: boolean;
}): Promise<SearchProvider> {
  return invoke<SearchProvider>("add_provider", {
    name: args.name,
    urlTemplate: args.urlTemplate,
    directDownload: args.directDownload ?? null,
    composeFilters: args.composeFilters ?? null,
  });
}

/**
 * Update an existing provider's fields. All fields are optional; only supplied
 * fields are changed.
 */
export function updateProvider(args: {
  id: number;
  name?: string;
  urlTemplate?: string;
  enabled?: boolean;
  directDownload?: boolean;
  composeFilters?: boolean;
}): Promise<SearchProvider> {
  return invoke<SearchProvider>("update_provider", {
    id: args.id,
    name: args.name ?? null,
    urlTemplate: args.urlTemplate ?? null,
    enabled: args.enabled ?? null,
    directDownload: args.directDownload ?? null,
    composeFilters: args.composeFilters ?? null,
  });
}

/** Remove a search provider by id. */
export function removeProvider(args: { id: number }): Promise<void> {
  return invoke<void>("remove_provider", { id: args.id });
}

/**
 * Probe previewed links for liveness (v0.19). OPT-IN — call only when the user
 * enables the "Check links" toggle. Each URL is checked with a cheap `HEAD`
 * request (a probe, **not** a content download) and classified alive / dead /
 * unknown. The backend bounds the work (URL cap, short timeout, capped
 * concurrency); URLs beyond the cap are simply not probed.
 */
export function probeLinks(urls: string[]): Promise<LinkStatus[]> {
  return invoke<LinkStatus[]>("probe_links", { urls });
}

/**
 * Run a search and preview each provider's results.
 *
 * Returns one {@link ProviderResults} group per provider, each holding the
 * scraped preview links plus the provider's `searchUrl`. **Never downloads
 * content** — open the user's chosen `url` in the system browser. If
 * `providerId` is supplied, only that provider is used; otherwise all enabled
 * providers contribute.
 *
 * `console`/`region` are the structured search filters (v0.18). They are
 * appended to a provider's query only when that provider has `composeFilters`
 * enabled; the frontend always uses them for client-side relevance ranking.
 */
export function runSearch(args: {
  query: string;
  console?: string;
  region?: string;
  providerId?: number;
}): Promise<ProviderResults[]> {
  return invoke<ProviderResults[]>("run_search", {
    query: args.query,
    console: args.console ?? null,
    region: args.region ?? null,
    providerId: args.providerId ?? null,
  });
}
