/**
 * Provider SERP health helpers (Phase 3). Pure — used to auto-collapse
 * captcha / SPA / empty groups and label them in the results UI.
 */

import type { ProviderResults, SerpHealth } from "../../ipc/search";

/** Normalize backend health string. */
export function providerHealth(group: ProviderResults): SerpHealth {
  if (group.error && (!group.health || group.health === "ok")) {
    // Legacy / network errors without an explicit health tag.
    return group.health === "captcha" || group.health === "js_shell"
      ? group.health
      : "error";
  }
  return group.health ?? (group.error ? "error" : group.items.length === 0 ? "empty" : "ok");
}

/** Groups that should start collapsed due to poor SERP health. */
export function isUnhealthyProvider(group: ProviderResults): boolean {
  const h = providerHealth(group);
  return h === "captcha" || h === "js_shell" || h === "empty" || h === "error";
}

/** Short chip label for the group header (null when healthy). */
export function healthBadgeLabel(group: ProviderResults): string | null {
  switch (providerHealth(group)) {
    case "captcha":
      return "captcha";
    case "js_shell":
      return "JS only";
    case "empty":
      return "no results";
    case "error":
      return "error";
    default:
      return null;
  }
}
