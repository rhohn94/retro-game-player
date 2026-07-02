// Ambient declarations for the Aura design language consumed from the
// channel-vendored tree (vendor/aura, pinned v3.541.0 via vendor.toml).
// Aura ships framework-free custom elements + a React adapter; this local
// typing dates from when upstream shipped no declarations (the
// design-language#858 era) and remains authoritative here. This file covers:
//   1. the `@aura/runtime` side-effect import (registers the custom elements),
//   2. the `@aura/css/*` CSS-barrel import,
//   3. the JSX ambient declaration so raw `<aura-*>` tags type-check in TSX.
// The typed `@aura/react` wrappers are declared in aura-react.d.ts (tsconfig
// `paths` resolves the import there). See design-language.md §2.3, §7.6.

import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** The Aura runtime barrel — imported for its `customElements.define` side
 * effect so the `<aura-*>` elements are registered before <App/> mounts. */
declare module "@aura/runtime";

/** The Aura CSS @layer barrel, imported by AuraProvider. */
declare module "@aura/css/aura.css";

// JSX ambient declaration: type the Aura custom elements so raw `<aura-*>` tags
// (and the wrappers, which render them) are accepted in TSX. Mirrors the
// wrappers plus the layout/shell primitives the archetypes use (§1, §5).
type AuraElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  events?: Record<string, (event: CustomEvent) => void>;
  variant?: string;
  [attr: string]: unknown;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "aura-app": AuraElementProps;
      "aura-card": AuraElementProps;
      "aura-grid": AuraElementProps;
      "aura-button": AuraElementProps;
      "aura-field": AuraElementProps;
      "aura-list": AuraElementProps;
      "aura-dialog": AuraElementProps;
      "aura-tabs": AuraElementProps;
      "aura-nav": AuraElementProps;
      "aura-select": AuraElementProps;
      "aura-switch": AuraElementProps;
      "aura-checkbox": AuraElementProps;
      "aura-radio": AuraElementProps;
      "aura-range": AuraElementProps;
      "aura-menu": AuraElementProps;
      "aura-editor": AuraElementProps;
    }
  }
}
