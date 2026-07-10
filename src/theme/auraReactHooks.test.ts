// Resolution test for the `@aura/react/hooks` alias (W396). This alias exists
// so the ~30 upstream Aura hooks (vendor/aura/bindings/react/hooks.js) are
// importable; the app has no obligation to adopt any specific hook yet, so
// this spec only proves the wiring — both the Vite/Vitest bundler alias (this
// import resolving at all) and the tsconfig `paths` entry (this file
// type-checks under `pnpm typecheck`) — rather than exercising hook behavior.
import { describe, expect, it } from "vitest";
import {
  useAuraCheckbox,
  useAuraDarkMode,
  useAuraDialog,
  useAuraTheme,
  type AuraEventMap,
} from "@aura/react/hooks";

describe("@aura/react/hooks alias", () => {
  it("resolves to the real vendored hook implementations", () => {
    expect(typeof useAuraTheme).toBe("function");
    expect(typeof useAuraDialog).toBe("function");
    expect(typeof useAuraDarkMode).toBe("function");
    expect(typeof useAuraCheckbox).toBe("function");
  });

  it("re-exports the typed AuraEventMap for hooks-only consumers", () => {
    // Type-only usage: proves the `AuraEventMap` re-export from aura-react.js
    // (via hooks.d.ts) resolves under our tsconfig `paths` mapping. Failing to
    // resolve would be a type error here, not a runtime one.
    const changeEventName: keyof AuraEventMap = "aura:change";
    expect(changeEventName).toBe("aura:change");
  });
});
