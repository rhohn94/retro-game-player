import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest config kept separate from vite.config.ts so the `test` block does not
// collide with Vite's UserConfig type under tsc. The frontend unit tests run in
// a plain node environment by default (the IPC layer is framework-free);
// `.test.tsx` specs (W360: ErrorBoundary render test) opt into jsdom via
// `environmentMatchGlobs` since they need a real DOM to mount React components,
// while every existing `.test.ts` spec keeps the cheaper node environment.
export default defineConfig({
  // Mirrors vite.config.ts's `@aura/*` aliases (vendor/aura Dependency
  // Channel bundle) so a `.tsx` spec importing an Aura-backed component
  // (e.g. ErrorNotice -> AuraCard) resolves the same way it does in the app
  // build, without duplicating the whole Vite config here.
  resolve: {
    alias: {
      "@aura/react/hooks": fileURLToPath(new URL("./vendor/aura/bindings/react/hooks.js", import.meta.url)),
      "@aura/react": fileURLToPath(new URL("./vendor/aura/bindings/react/aura-react.js", import.meta.url)),
      "@aura/css": fileURLToPath(new URL("./vendor/aura/css", import.meta.url)),
      "@aura/runtime": fileURLToPath(new URL("./vendor/aura/dist/aura.js", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
  },
});
