import { defineConfig } from "vitest/config";

// Vitest config kept separate from vite.config.ts so the `test` block does not
// collide with Vite's UserConfig type under tsc. The frontend unit tests run in
// a plain node environment (the IPC layer is framework-free).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
