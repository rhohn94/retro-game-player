// Flat ESLint config for the Harmony frontend (TS + React).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Lint ONLY the app's TS sources. Everything else (Grimoire workflow scripts
  // under .claude/, build output, the Rust crate, config files) is out of scope.
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "node_modules/**",
      ".claude/**",
      // Grimoire framework-internal trees (archives, golden baseline, sync
      // provenance/backups) hold workflow `.js` scripts that use top-level
      // `return` — valid in their execution harness, not as plain modules. They
      // are not Harmony source and must not be linted.
      ".grimoire-archive/**",
      ".grimoire-golden/**",
      ".scaffold-base/**",
      ".scaffold-sync-backup/**",
      // The Aura design language is vendored as a git submodule (W2); it is
      // third-party source pinned at v3.20 and is not linted by Harmony.
      "vendor/**",
      "*.config.js",
      "*.config.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
);
