/**
 * File-search provider IPC wrappers (W9 / W17).
 *
 * Design contract: `runSearch` returns constructed links ONLY — the backend
 * never fetches URLs server-side and never auto-downloads anything. The caller
 * is responsible for opening links in the system browser. Ships with an empty
 * provider list; users add providers manually.
 *
 * Master contract: architecture-design.md §2.5
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
}

/**
 * A single search result — a constructed link to open in the system browser.
 * The backend never fetches or parses the target URL.
 */
export interface SearchResult {
  providerId: number;
  providerName: string;
  /** Equals `providerName` (the app only constructs links, never titles). */
  title: string;
  /** Fully-constructed URL; pass to `shell.open()` or equivalent. */
  url: string;
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
}): Promise<SearchProvider> {
  return invoke<SearchProvider>("add_provider", {
    name: args.name,
    urlTemplate: args.urlTemplate,
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
}): Promise<SearchProvider> {
  return invoke<SearchProvider>("update_provider", {
    id: args.id,
    name: args.name ?? null,
    urlTemplate: args.urlTemplate ?? null,
    enabled: args.enabled ?? null,
  });
}

/** Remove a search provider by id. */
export function removeProvider(args: { id: number }): Promise<void> {
  return invoke<void>("remove_provider", { id: args.id });
}

/**
 * Construct search links for `query`.
 *
 * **Returns links only — never auto-downloads.** Open each result's `url` in
 * the system browser. If `providerId` is supplied, only that provider is used;
 * otherwise all enabled providers contribute one link each.
 */
export function runSearch(args: {
  query: string;
  providerId?: number;
}): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("run_search", {
    query: args.query,
    providerId: args.providerId ?? null,
  });
}
