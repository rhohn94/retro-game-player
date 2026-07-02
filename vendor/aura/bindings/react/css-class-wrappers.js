"use client";
/* ==========================================================================
   Aura — React CSS-class component wrappers (hand-authored).

   Aura has two flavours of component:
     1. Custom elements (`<aura-button>` etc.) — wrapped automatically by the
        generated `aura-react.js` / `aura-react.d.ts` pair.
     2. CSS-class-enhanced elements — plain HTML elements that Aura's CSS and
        JS enhance via class names / data-attributes.  These cannot be covered
        by the code-generator because there is no element registry entry to
        introspect.  This file ships hand-authored thin wrappers for that set.

   Wrappers shipped here:
     • AuraSidebar      — `.aura-sidebar[data-aura-sidebar="reveal"]` (#855)
     • AuraDisclosure   — `<details class="aura-disclosure">` (#857)
     • AuraAlert        — `.aura-alert[data-variant?]`
     • AuraCopyButton   — `.aura-copy[data-aura-copy]`
     • AuraTableWrap    — `.aura-table-wrap[tabindex][role="region"][aria-label]` (a11y scroll container)
     • AuraTable        — `<table class="aura-table [aura-table--sticky-head]">`
     • AuraSkeleton     — `.aura-skeleton[aura-skeleton--{variant}][aura-skeleton--short]`
     • AuraSkeletonGroup — `.aura-skeleton-group`

   Skipped candidates (see bindings/README.md §CSS-class component wrappers):
     • aura-region    — CSS block element, no required attributes; the native
                        <aura-region> tag works in JSX without a wrapper.
     • aura-accordion — not a standalone CSS pattern; accordion UIs are
                        composed from multiple <aura-disclosure> elements.

   Do NOT edit `aura-react.js` or `jsx.d.ts` — those are generated.
   ========================================================================== */
import { createElement, forwardRef } from "react";

/* -------------------------------------------------------------------------- */
/* AuraSidebar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * CSS-class-enhanced sidebar nav.
 *
 * Renders `<nav class="aura-sidebar" data-aura-sidebar="reveal">` so that
 * `js/sidebar.js` picks it up and adds proximity-expand / click-pin behaviour.
 * React owns the initial markup; sidebar.js owns runtime attribute mutations
 * (`data-sidebar-expanded`, `aria-expanded`) — do NOT mirror those in state.
 *
 * @example
 * ```jsx
 * <AuraSidebar aria-label="Page navigation">
 *   <a href="/">Home</a>
 *   <a href="/about">About</a>
 * </AuraSidebar>
 * ```
 */
export const AuraSidebar = forwardRef(function AuraSidebar(props, ref) {
  const { className, children, ...rest } = props;
  const mergedClass = className ? "aura-sidebar " + className : "aura-sidebar";
  return createElement(
    "nav",
    { ...rest, ref, className: mergedClass, "data-aura-sidebar": "reveal" },
    children
  );
});

/* -------------------------------------------------------------------------- */
/* AuraDisclosure                                                               */
/* -------------------------------------------------------------------------- */

/**
 * CSS-class disclosure built on the native `<details>` element.
 *
 * Renders the canonical Aura markup structure:
 * ```html
 * <details class="aura-disclosure">
 *   <summary class="aura-disclosure__summary">…summary…</summary>
 *   <div class="aura-disclosure__panel">…children…</div>
 * </details>
 * ```
 *
 * The browser handles open/close, keyboard operation, and `aria-expanded`
 * natively — no JavaScript enhancement is needed.  Controlled consumers can
 * pass `open` and listen to the native `onToggle` event.
 *
 * @example
 * ```jsx
 * <AuraDisclosure summary="Section title">
 *   Panel body content here.
 * </AuraDisclosure>
 * ```
 */
export const AuraDisclosure = forwardRef(function AuraDisclosure(props, ref) {
  const { className, summary, children, ...rest } = props;
  const mergedClass = className ? "aura-disclosure " + className : "aura-disclosure";
  return createElement(
    "details",
    { ...rest, ref, className: mergedClass },
    createElement(
      "summary",
      { className: "aura-disclosure__summary" },
      summary
    ),
    createElement("div", { className: "aura-disclosure__panel" }, children)
  );
});

/* -------------------------------------------------------------------------- */
/* AuraAlert                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Thin React wrapper for the `.aura-alert` CSS-class component.
 *
 * Renders a `<div role="alert">` with the `.aura-alert` class and an optional
 * `data-variant` attribute. Pure CSS — no JS enhancement.
 *
 * @param {"success"|"warning"|"danger"|"info"|"neutral"} [props.variant]
 *   Status variant. Omit for the default (info) style.
 * @param {React.ReactNode} props.children  Alert content.
 *
 * @example
 * ```jsx
 * <AuraAlert variant="success">Saved successfully.</AuraAlert>
 * <AuraAlert variant="danger">Something went wrong.</AuraAlert>
 * ```
 */
export const AuraAlert = forwardRef(function AuraAlert(props, ref) {
  const { variant, children, ...rest } = props;
  return createElement(
    "div",
    { ...rest, ref, role: "alert", "data-variant": variant, className: "aura-alert" },
    children
  );
});
AuraAlert.displayName = "AuraAlert";

/* -------------------------------------------------------------------------- */
/* AuraCopyButton                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Thin React wrapper for the `.aura-copy[data-aura-copy]` copy-to-clipboard
 * affordance.
 *
 * Renders a `<button type="button">` with the `.aura-copy` class and the
 * `data-aura-copy` attribute that `copy.js` delegates on. Clicking the button
 * copies `copyText` to the clipboard and flashes the "Copied" state for 1.6 s.
 *
 * **Accessibility:** the caller MUST provide an accessible name — either via
 * `children` (text) or an explicit `aria-label` prop.
 *
 * @param {string} props.copyText  The text to copy to the clipboard.
 * @param {string} [props.copiedLabel]  Visible label shown during the "Copied"
 *   flash (default: "Copied"). Decoupled from the screen-reader announcement
 *   which always says "Copied to clipboard" (#705).
 * @param {React.ReactNode} props.children  Button content (required for a11y).
 *
 * @example
 * ```jsx
 * <AuraCopyButton copyText="npm install @aura-design/core">
 *   <span className="aura-copy__label">Copy</span>
 * </AuraCopyButton>
 * ```
 */
export const AuraCopyButton = forwardRef(
  function AuraCopyButton({ copyText, copiedLabel, children, ...props }, ref) {
    return createElement(
      "button",
      Object.assign({ ref, type: "button", className: "aura-copy",
        "data-aura-copy": copyText,
        "data-copied-label": copiedLabel }, props),
      children
    );
  }
);
AuraCopyButton.displayName = "AuraCopyButton";

/* -------------------------------------------------------------------------- */
/* AuraTableWrap                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Accessible scroll container for an `.aura-table` — renders
 * `<div class="aura-table-wrap" tabindex="0" role="region" aria-label="…">`.
 *
 * The `tabindex`, `role`, and `aria-label` are required for WCAG 2.1 SC 1.4.12
 * and keyboard accessibility of the horizontal scroll region; this wrapper
 * ensures they are never omitted.
 *
 * **Required:** pass an `aria-label` prop describing the table contents
 * (e.g. `"Recent invoices"`) — screen readers announce it as the region name.
 *
 * @param {string} props["aria-label"]  Required accessible name for the scroll region.
 * @param {React.ReactNode} props.children  The `<AuraTable>` (or native `<table>`) element.
 *
 * @example
 * ```jsx
 * <AuraTableWrap aria-label="Q4 sales data">
 *   <AuraTable stickyHead>
 *     <thead>…</thead>
 *     <tbody>…</tbody>
 *   </AuraTable>
 * </AuraTableWrap>
 * ```
 */
export const AuraTableWrap = forwardRef(function AuraTableWrap(props, ref) {
  const { className, children, ...rest } = props;
  const mergedClass = className ? "aura-table-wrap " + className : "aura-table-wrap";
  return createElement(
    "div",
    Object.assign({ ref, tabIndex: 0, role: "region" }, rest, { className: mergedClass }),
    children
  );
});
AuraTableWrap.displayName = "AuraTableWrap";

/* -------------------------------------------------------------------------- */
/* AuraTable                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Thin React wrapper for the `.aura-table` CSS-class data table.
 *
 * Renders `<table class="aura-table [aura-table--sticky-head]">`.
 * Always place inside an `<AuraTableWrap>` so the accessible scroll container
 * attributes are never omitted.
 *
 * @param {boolean} [props.stickyHead]  When `true`, adds `.aura-table--sticky-head`
 *   so `<thead>` cells remain visible while scrolling vertically.
 *
 * @example
 * ```jsx
 * <AuraTableWrap aria-label="Order history">
 *   <AuraTable stickyHead>
 *     <thead><tr><th>Date</th><th>Amount</th></tr></thead>
 *     <tbody>…</tbody>
 *   </AuraTable>
 * </AuraTableWrap>
 * ```
 */
export const AuraTable = forwardRef(function AuraTable(props, ref) {
  const { className, stickyHead, children, ...rest } = props;
  const base = "aura-table";
  const sticky = stickyHead ? " aura-table--sticky-head" : "";
  const mergedClass = className ? base + sticky + " " + className : base + sticky;
  return createElement("table", { ...rest, ref, className: mergedClass }, children);
});
AuraTable.displayName = "AuraTable";

/* -------------------------------------------------------------------------- */
/* AuraSkeleton                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * CSS-class loading skeleton placeholder.
 *
 * Renders `<span class="aura-skeleton [aura-skeleton--{variant}] [aura-skeleton--short]"
 * aria-hidden="true">`. The skeleton element is purely decorative — `aria-hidden`
 * is set automatically so screen readers skip it.
 *
 * @param {"text"|"block"|"circle"} [props.variant]
 *   Shape variant:
 *   - `"text"` — single text-line height strip (default appearance when omitted).
 *   - `"block"` — full-height block (use for image placeholders, card bodies).
 *   - `"circle"` — square with `border-radius: 50%` (avatar, icon placeholders).
 * @param {boolean} [props.short]  Narrows the element to ~60% width (useful for
 *   the second line of a two-line text skeleton to suggest a shorter paragraph).
 *
 * @example
 * ```jsx
 * <AuraSkeletonGroup>
 *   <AuraSkeleton variant="circle" />
 *   <div>
 *     <AuraSkeleton variant="text" />
 *     <AuraSkeleton variant="text" short />
 *   </div>
 * </AuraSkeletonGroup>
 * ```
 */
export const AuraSkeleton = forwardRef(function AuraSkeleton(props, ref) {
  const { className, variant, short, ...rest } = props;
  const classes = ["aura-skeleton"];
  if (variant) classes.push("aura-skeleton--" + variant);
  if (short) classes.push("aura-skeleton--short");
  if (className) classes.push(className);
  return createElement("span", Object.assign({ "aria-hidden": "true" }, rest, { ref, className: classes.join(" ") }));
});
AuraSkeleton.displayName = "AuraSkeleton";

/* -------------------------------------------------------------------------- */
/* AuraSkeletonGroup                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Container for a group of `<AuraSkeleton>` elements.
 *
 * Renders `<div class="aura-skeleton-group">`. Use this to wrap a set of
 * skeleton placeholders that together represent a loading content region.
 * Nest `<AuraSkeletonGroup>` elements for complex layouts (e.g. a circle
 * avatar next to a two-line text group).
 *
 * @example
 * ```jsx
 * <AuraSkeletonGroup>
 *   <AuraSkeleton variant="circle" />
 *   <AuraSkeletonGroup>
 *     <AuraSkeleton variant="text" />
 *     <AuraSkeleton variant="text" short />
 *   </AuraSkeletonGroup>
 * </AuraSkeletonGroup>
 * ```
 */
export const AuraSkeletonGroup = forwardRef(function AuraSkeletonGroup(props, ref) {
  const { className, children, ...rest } = props;
  const mergedClass = className ? "aura-skeleton-group " + className : "aura-skeleton-group";
  return createElement("div", { ...rest, ref, className: mergedClass }, children);
});
AuraSkeletonGroup.displayName = "AuraSkeletonGroup";
