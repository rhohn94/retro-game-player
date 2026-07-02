import type {
  ForwardRefExoticComponent,
  RefAttributes,
  HTMLAttributes,
  ButtonHTMLAttributes,
  DetailsHTMLAttributes,
  TableHTMLAttributes,
  ReactNode,
} from "react";

/**
 * CSS-class enhanced sidebar nav (wraps `.aura-sidebar[data-aura-sidebar="reveal"]`).
 *
 * @example
 * ```tsx
 * <AuraSidebar>
 *   <nav>…</nav>
 * </AuraSidebar>
 * ```
 */
export const AuraSidebar: ForwardRefExoticComponent<
  HTMLAttributes<HTMLElement> & { children?: ReactNode } & RefAttributes<HTMLElement>
>;

/**
 * CSS-class disclosure built on the native `<details>` element (wraps `<details class="aura-disclosure">`).
 *
 * @example
 * ```tsx
 * <AuraDisclosure summary="Show details">
 *   <p>Hidden content revealed on expand.</p>
 * </AuraDisclosure>
 * ```
 */
export const AuraDisclosure: ForwardRefExoticComponent<
  DetailsHTMLAttributes<HTMLDetailsElement> & {
    /** Content rendered inside `<summary class="aura-disclosure__summary">`. */
    summary?: ReactNode;
    children?: ReactNode;
  } & RefAttributes<HTMLDetailsElement>
>;

export interface AuraAlertProps extends HTMLAttributes<HTMLDivElement> {
  /** Status variant: success · warning · danger · info · neutral. Default renders as info. */
  variant?: "success" | "warning" | "danger" | "info" | "neutral";
}

/**
 * Thin wrapper for `.aura-alert[data-variant?]`. Renders a `<div role="alert">`.
 *
 * @example
 * ```tsx
 * <AuraAlert variant="success">Your changes have been saved.</AuraAlert>
 * <AuraAlert variant="danger">Something went wrong — please try again.</AuraAlert>
 * ```
 */
export declare const AuraAlert: ForwardRefExoticComponent<
  AuraAlertProps & RefAttributes<HTMLDivElement>
>;

export interface AuraCopyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The text written to the clipboard on click (maps to `data-aura-copy`). */
  copyText: string;
  /** Visible label shown during the 1.6 s "Copied" flash. Default: "Copied". */
  copiedLabel?: string;
}

/**
 * Thin wrapper for `.aura-copy[data-aura-copy]`. Renders a `<button type="button">`.
 *
 * @example
 * ```tsx
 * <AuraCopyButton copyText="npm install @aura-design/core" copiedLabel="Copied!">
 *   Copy install command
 * </AuraCopyButton>
 * ```
 */
export declare const AuraCopyButton: ForwardRefExoticComponent<
  AuraCopyButtonProps & RefAttributes<HTMLButtonElement>
>;

export interface AuraTableWrapProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Required accessible name for the scroll region — announced by screen readers
   * as the `role="region"` label. Example: `"Q4 sales data"`.
   */
  "aria-label": string;
  children?: ReactNode;
}

/**
 * Accessible scroll container for an `.aura-table`. Renders
 * `<div class="aura-table-wrap" tabindex="0" role="region" aria-label="…">`.
 *
 * The `tabindex`, `role`, and `aria-label` attributes are required for WCAG 2.1
 * SC 1.4.12 keyboard accessibility of horizontal scroll regions. Always wrap
 * an `<AuraTable>` with this component.
 *
 * @example
 * ```tsx
 * <AuraTableWrap aria-label="Q4 sales data">
 *   <AuraTable stickyHead>
 *     <thead>…</thead>
 *     <tbody>…</tbody>
 *   </AuraTable>
 * </AuraTableWrap>
 * ```
 */
export declare const AuraTableWrap: ForwardRefExoticComponent<
  AuraTableWrapProps & RefAttributes<HTMLDivElement>
>;

export interface AuraTableProps extends TableHTMLAttributes<HTMLTableElement> {
  /**
   * When `true`, adds `.aura-table--sticky-head` so `<thead>` cells remain
   * pinned while the table body scrolls vertically.
   */
  stickyHead?: boolean;
  children?: ReactNode;
}

/**
 * Thin React wrapper for `.aura-table`. Renders
 * `<table class="aura-table [aura-table--sticky-head]">`.
 *
 * Always place inside an `<AuraTableWrap>` to get the required a11y attributes.
 *
 * @example
 * ```tsx
 * <AuraTableWrap aria-label="Order history">
 *   <AuraTable stickyHead>
 *     <thead><tr><th>Date</th><th>Amount</th></tr></thead>
 *     <tbody>…</tbody>
 *   </AuraTable>
 * </AuraTableWrap>
 * ```
 */
export declare const AuraTable: ForwardRefExoticComponent<
  AuraTableProps & RefAttributes<HTMLTableElement>
>;

export interface AuraSkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Shape variant:
   * - `"text"` — text-line-height strip (default appearance).
   * - `"block"` — full-height rectangle for image or card placeholders.
   * - `"circle"` — `border-radius: 50%` for avatar or icon placeholders.
   */
  variant?: "text" | "block" | "circle";
  /**
   * When `true`, narrows the element to ~60% width — useful for the second
   * line of a two-line skeleton to suggest a shorter paragraph ending.
   */
  short?: boolean;
}

/**
 * CSS-class loading skeleton placeholder. Renders
 * `<span class="aura-skeleton [aura-skeleton--{variant}] [aura-skeleton--short]"
 * aria-hidden="true">`.
 *
 * `aria-hidden` is set automatically — skeletons are decorative and must not
 * be announced by screen readers.
 *
 * @example
 * ```tsx
 * <AuraSkeletonGroup>
 *   <AuraSkeleton variant="circle" />
 *   <div>
 *     <AuraSkeleton variant="text" />
 *     <AuraSkeleton variant="text" short />
 *   </div>
 * </AuraSkeletonGroup>
 * ```
 */
export declare const AuraSkeleton: ForwardRefExoticComponent<
  AuraSkeletonProps & RefAttributes<HTMLSpanElement>
>;

/**
 * Container for a group of `<AuraSkeleton>` elements. Renders
 * `<div class="aura-skeleton-group">`.
 *
 * @example
 * ```tsx
 * <AuraSkeletonGroup>
 *   <AuraSkeleton variant="circle" />
 *   <AuraSkeletonGroup>
 *     <AuraSkeleton variant="text" />
 *     <AuraSkeleton variant="text" short />
 *   </AuraSkeletonGroup>
 * </AuraSkeletonGroup>
 * ```
 */
export declare const AuraSkeletonGroup: ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & { children?: ReactNode } & RefAttributes<HTMLDivElement>
>;
