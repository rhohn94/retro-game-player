import { defineConfig } from "vitest/config";
import { auraAliases } from "./vite/aura-aliases";

// Vitest config kept separate from vite.config.ts so the `test` block does not
// collide with Vite's UserConfig type under tsc. The frontend unit tests run in
// a plain node environment by default (the IPC layer is framework-free);
// `.test.tsx` specs (W360: ErrorBoundary render test) opt into jsdom via
// `environmentMatchGlobs` since they need a real DOM to mount React components,
// while every existing `.test.ts` spec keeps the cheaper node environment.
export default defineConfig({
  // Single-sourced from vite/aura-aliases.ts (shared with vite.config.ts) so a
  // `.tsx` spec importing an Aura-backed component (e.g. ErrorNotice ->
  // AuraCard) resolves the same way it does in the app build, without
  // duplicating the whole Vite config here or hand-mirroring the alias map.
  resolve: {
    alias: auraAliases,
  },
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
  },
});
