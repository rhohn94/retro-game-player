# Interaction Wiring (Aura ↔ React) — Design

> **Up:** [↑ Docs](../README.md) · **Sib:** [games-directory](games-directory-design.md),
> [library-filtering](library-filtering-design.md)

## 1. Problem

Harmony renders the [Aura](../../vendor/aura) design system, which ships as
framework-free **custom elements**, through a thin React adapter
(`vendor/aura/bindings/react/aura-react.js`). The adapter forwards standard
props (including `onClick`) onto the custom element and wires a separate
`events={{ … }}` map via `addEventListener`. Because `addEventListener` accepts
any string, an `events` key that names a **non-existent** event registers a
listener that can never fire — a silent failure with no type error and no
runtime warning. Several screens were built against an imagined Aura event API,
producing dead controls that still type-check and still pass the test suite.

## 2. Ground-truth Aura contracts

Extracted from `vendor/aura/js/*.js` (authoritative):

| Element | Emits | Correct React wiring | Dead anti-pattern |
|---|---|---|---|
| `<aura-button>` | native `click` only (`this.click()` on Enter/Space) | `onClick={fn}` | `events={{ "aura-click": fn }}` |
| `<aura-field>` | nothing — it is a **label/glow wrapper** around a contained `CONTROL_SELECTOR` child | contained `<input>`/`<select>`/`<textarea>` with React `value`+`onChange`; optional `label` attr on the field | `value`/`type`/`placeholder` props on the field + `events={{ "aura-field:input": fn }}`, with no child control |
| `<aura-select>` | `aura:change` (colon); projects `<aura-option>` children | `<aura-option>` children + `events={{ "aura:change": fn }}` — **or** a native `<select>`+`onChange` | native `<option>` children + `events={{ "aura-change": fn }}` |
| `<aura-dialog>` | `aura:dialog-open` / `aura:dialog-close`; driven by the `open` attribute | `open={bool}` | — (already correct in app) |

## 3. Decisions

- **Buttons → `onClick`.** The native-click path is what Aura actually fires and
  what React delegates; it already works for every button that used it
  (CoreRow, GameDetailPage, the dialog action buttons).
- **Fields → contained native `<input>`.** Matches the working
  FamiliarPane/RetroArchPane fields. The `ref` (for auto-focus) moves onto the
  inner `<input>`, not the wrapper. A shared `.harmony-input` class
  (token-driven) styles the contained inputs.
- **Selects → native `<select>`.** Rather than re-home the options onto
  `<aura-option>` and adopt the custom dropdown, the two Settings selects use a
  native `<select>`+`onChange` — the exact pattern LibraryFilters already uses
  successfully. It is accessible, trivially testable, and visually consistent.
  A custom Aura dropdown is a deferred polish item, not a correctness need.

## 4. Guardrails (so this never silently ships again)

1. **Static guard** — `scripts/aura-wiring.test.mjs` (vitest) scans `src/` and
   fails on any literal `aura-click`, `aura-field:input`, or hyphenated
   `aura-change` listener key, or any `<AuraField …>` carrying input props
   (`value=`/`type=`/`placeholder=`) without a child control. Deterministic, no
   browser, runs in `pnpm test`.
2. **Real-gesture proof** — `scripts/inspect-create-success.mjs` and the search
   inspect drive the UI with **real** `page.click()` / typed input (not a
   synthetic `aura-click` dispatch) and assert the resulting state change,
   failing non-zero on regression.

The prior tests failed precisely because they fabricated the same fictional
event they were verifying; the rule going forward is that an interaction test
must use a real user gesture against the real Aura element.

## 5. Focus-visible styling contract (W283)

**One central rule, not per-component CSS.** `src/theme/focus-visible.css`
(imported once in `AuraProvider.tsx`, alongside `motion.css`/`tv.css`) declares
a single `:focus-visible` rule, in the app's `rgp-theme` cascade layer, over a
`:where(...)` selector list covering every native focusable element/ARIA role
this app uses (`a`, `button`, `input`, `select`, `textarea`, `summary`,
`[tabindex]`, `[role="button"/"option"/"tab"/"menuitem"/"checkbox"/"radio"/
"link"]`, plus the `aura-button`/`aura-select` custom elements):

```css
@layer rgp-theme {
  :where(a, button, input, /* … */):focus-visible {
    outline: var(--rgp-focus-ring);
    outline-offset: var(--rgp-focus-ring-offset);
  }
}
```

This replaced the same three-line declaration previously copy-pasted across
`consoles.css`, `cores.css`, `library.css`, `tv-shell.css`, and
`controllers-pane.css` — the exact per-component duplication
`docs/coding-standards/css.md`'s DRY rule (`css-dry-declarations`) flags. A new
component gets the ring for free with zero CSS of its own; a component only
writes its own `:focus-visible` rule when it does something MORE than draw the
ring (e.g. `TvSystemMenu`'s focused-row background/scale swap, `TvTile`'s card
lift) — those rules no longer repeat the ring declaration itself.

**Why `:where(...)`.** Wrapping the whole selector list in `:where()` gives it
**zero specificity**, so it never wins a specificity fight against a
component's own more-specific `:focus-visible` rule — the component rule
layers on top (adds background/scale/etc.) rather than needing `!important` or
careful ordering to coexist with the central ring. This mirrors the CSS
standards' "keep selector specificity flat" rule (`css-flat-specificity`)
applied to the ring itself.

**`:focus-visible`, never bare `:focus`.** A mouse/touch click never shows the
ring — only keyboard/assistive-tech-driven focus does, matching the browser's
own heuristic for "was this focus likely intentional keyboard navigation" (the
same distinction `TvTile`/`TvSystemMenu` already drew manually via their own
`:focus-visible` rules before this change).

**Cascade-layer caveat.** A handful of files predate the `@layer rgp-theme`
convention and are still unlayered (`cores.css`, `controllers-pane.css`) —
per the CSS cascade-layers spec, **unlayered rules always beat every layered
rule**, specificity notwithstanding. An unlayered file that ever adds its own
`outline: none` would silently defeat the central ring with no specificity
warning; there is none today (audited as part of W283), but a future edit to
either file must not add one. Migrating both files into `@layer rgp-theme` is
a nice-to-have cleanup, not required for this rule to work correctly, so it
is not bundled into this change.

**Token-only.** The rule consumes the existing `--rgp-focus-ring`/
`--rgp-focus-ring-offset` tokens (declared once in `aura-theme.css`) — the same
tokens `FocusRing.tsx` (the controller-driven "virtual focus" visual for
non-native focus targets, e.g. TV tiles before `useEffect` mirrors focus onto
the real DOM node) already reads, so keyboard focus and controller focus
always render as the identical ring. No new token was introduced.

**Native-focus ↔ controller-focus bridge.** Several controller-only surfaces
(the desktop sidebar's `FocusableNavItem`/`FullscreenButton`/`TvModeButton` in
`App.tsx`, `TvSystemMenu`'s rows) drew their controller-focus ring from an
inline `style={{ outline: isFocused ? … : "none" }}` keyed on `useFocusable`'s
`isFocused` — which only becomes true when the CONTROLLER focus registry
points at that element. Before W283 these elements had no `onFocus` handler,
so Tab-ing to them directly (no gamepad ever touched) never set `isFocused`,
and the ring never appeared for a pure keyboard user. The fix mirrors the
bridge `TvTile`/`GameTile` already established: `onFocus={focus}` claims
controller focus the moment native DOM focus lands, so a keyboard Tab and a
gamepad nav press converge on the exact same focus state and ring.
