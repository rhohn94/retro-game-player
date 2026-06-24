// Type declarations for the `@aura/react` adapter — Aura's bindings/react ships
// as plain JS with NO TypeScript types (design-language#858), so W2 types it
// here. tsconfig `paths` maps the `@aura/react` import to this file; the Vite
// alias maps the runtime import to vendor/aura/bindings/react/aura-react.js.
// See docs/design/ux/design-language.md §2.3, §7.2, §7.6.

import type { ForwardRefExoticComponent, HTMLAttributes, ReactNode, RefAttributes } from "react";

/**
 * Props common to every Aura React wrapper. Beyond standard HTML attributes the
 * wrapper accepts an `events` map (CustomEvent name → listener) wired via
 * addEventListener — the adapter contract that replaces React's `onChange`; and
 * `class` (not `className`) selects Aura BEM variants (design-language.md §7.2).
 */
export interface AuraWrapperProps
  extends HTMLAttributes<HTMLElement>,
    RefAttributes<HTMLElement> {
  events?: Record<string, (event: CustomEvent) => void>;
  variant?: string;
  class?: string;
  children?: ReactNode;
  [attr: string]: unknown;
}

export type AuraComponent = ForwardRefExoticComponent<AuraWrapperProps>;

export function createAuraComponent(tagName: string): AuraComponent;

export const AuraApp: AuraComponent;
export const AuraButton: AuraComponent;
export const AuraCard: AuraComponent;
export const AuraField: AuraComponent;
export const AuraSwitch: AuraComponent;
export const AuraCheckbox: AuraComponent;
export const AuraRadio: AuraComponent;
export const AuraSelect: AuraComponent;
export const AuraRange: AuraComponent;
export const AuraEditor: AuraComponent;
export const AuraMenu: AuraComponent;
export const AuraDialog: AuraComponent;
export const AuraTabs: AuraComponent;
