// Ambient declarations for the Aura design language consumed from the
// channel-vendored tree (vendor/aura, pinned v3.541.0 via vendor.toml).
// The typed `@aura/react` wrappers AND the raw `<aura-*>` JSX intrinsics now
// come from Aura's own generated types (W396): tsconfig `paths` resolves
// `@aura/react` straight to `vendor/aura/bindings/react/aura-react.d.ts`,
// which pulls in `jsx.d.ts` via its own triple-slash reference — so raw tags
// type-check without any local shim. This file covers only what genuinely
// has no upstream .d.ts — both are app-local Vite aliases, not part of
// Aura's own published type surface:
//   1. the `@aura/runtime` side-effect import (registers the custom elements),
//   2. the `@aura/css/*` CSS-barrel import.
// See design-language.md §2.3, §7.

/** The Aura runtime barrel — imported for its `customElements.define` side
 * effect so the `<aura-*>` elements are registered before <App/> mounts. */
declare module "@aura/runtime";

/** The Aura CSS @layer barrel, imported by AuraProvider. */
declare module "@aura/css/aura.css";
