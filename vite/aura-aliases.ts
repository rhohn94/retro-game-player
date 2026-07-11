import { fileURLToPath, URL } from "node:url";

// Single source of truth for the `@aura/*` path aliases, shared by
// vite.config.ts (dev server + build) and vitest.config.ts (unit tests) so the
// two never drift out of sync by hand. Aura is vendored via the Dependency
// Channel (vendor.toml [deps.aura]); these aliases let app code import it by
// stable names regardless of where the vendored tree physically sits. See
// docs/design/ux/design-language.md §2.3.

// This module lives one directory below the repo root, so alias targets are
// resolved relative to `../<path>` from here.
function resolveVendored(pathFromRoot: string): string {
  return fileURLToPath(new URL(`../${pathFromRoot}`, import.meta.url));
}

// Longest-prefix alias FIRST: plugin-alias matches "@aura/react" as a
// path-segment prefix of "@aura/react/hooks" too, so the hooks entry must be
// listed before the bare "@aura/react" one or it never wins. Object key order
// is insertion order for string keys, and both Vite and Vitest iterate
// `resolve.alias` in that order, so this ordering is load-bearing.
export const auraAliases: Record<string, string> = {
  "@aura/react/hooks": resolveVendored("vendor/aura/bindings/react/hooks.js"),
  "@aura/react": resolveVendored("vendor/aura/bindings/react/aura-react.js"),
  "@aura/css": resolveVendored("vendor/aura/css"),
  "@aura/runtime": resolveVendored("vendor/aura/dist/aura.js"),
};
