# Aura framework bindings

Aura is **framework-free** — its core is vanilla custom elements that work in any
page. These bindings are **optional, additive** ergonomic adapters for apps built
in React, Vue, or Svelte. The vanilla core never depends on them; they depend on
the core.

## Getting Aura

Aura is consumable two ways; both expose the same `@aura-design/core/…` specifiers used below.

- **npm** — the package name is **`@aura-design/core`** (scoped; the bare
  registry name `aura` belongs to an unrelated third-party project — never
  install it). This repo's `package.json` carries the full `exports` map
  (resolving `@aura-design/core`, `@aura-design/core/dist/aura.{js,css}`,
  `@aura-design/core/css/aura.css`, `@aura-design/core/esm/*`,
  `@aura-design/core/templates/*`, and the three
  `@aura-design/core/bindings/{react,vue,svelte}` entries). Until the first
  human-gated publish lands on the registry (see
  `docs/design/distribution-design.md` §3b), install from git
  (`npm install <this-repo-url>` — all specifiers resolve identically) or use
  the submodule path below.

  > **Committed-dist contract (#477).** A git install does **not** build: npm
  > runs `prepare` on a git install and this package intentionally defines no
  > `prepare` step (a consumer's environment has neither `just` nor the
  > Python/Node toolchain the build needs). The git install works because the
  > built `dist/` artifacts are **committed to the repo** — `import
  > "@aura-design/core/dist/aura.js"` resolves straight from the checkout. This
  > coupling is load-bearing and enforced: the `just check` gate
  > `check-dist` (`tools/check_dist_tracked.py`) fails the release if any
  > required `dist/` artifact is missing or becomes gitignored.
- **git submodule** — `git submodule add <this-repo-url> vendor/aura`, then point
  the same specifiers at `vendor/aura/…` (e.g. `vendor/aura/dist/aura.js`). No
  install or build step.
- **release asset** — each published GitHub Release attaches
  `aura-vX.Y.{zip,tar.gz}` carrying `css/ js/ dist/ templates/` **and
  `bindings/`** (since v3.538, #858), so sha256-pinned vendor syncs get the
  official adapters through the release channel too — no submodule fallback
  needed.

In every case the flow is the same:

1. **Load the Aura runtime once** so the elements register —
   `import "@aura-design/core/dist/aura.js"` (bundle) or include the source modules.
2. **Load the stylesheet** — `@aura-design/core/dist/aura.css` (or `@aura-design/core/css/aura.css`).
3. **Use the adapter** for your framework.

| Framework | File | Types | What it adds |
|---|---|---|---|
| React | [`react/aura-react.js`](react/aura-react.js) | **Typed** (`aura-react.d.ts`, `hooks.d.ts`, `jsx.d.ts`) | `createAuraComponent(tag)` + one generated wrapper per registry element (54 tags) that forward refs, reflect boolean props as attribute presence/absence (React ≤18 safe), and wire custom-event handlers via an `events` prop with stable listeners. [`react/jsx.d.ts`](react/jsx.d.ts) types every raw `aura-*` tag for TSX and is **auto-wired** — `aura-react.d.ts` triple-slash-references it, so importing from `@aura-design/core/bindings/react` is enough; no manual `include` needed (#545). Raw-tag `onChange` is a type error (it never fires on a custom element — use `events`) (#550). The wrappers + JSX (`aura-react.{js,d.ts}`, `jsx.d.ts`) are **generated** by `tools/aura_react.py` — do not hand-edit them; the hooks ([`react/hooks.js`](react/hooks.js), [`react/hooks.d.ts`](react/hooks.d.ts)) are **hand-authored** (see "Generated vs hand-authored" below). |
| Vue 3 | [`vue/aura-vue.js`](vue/aura-vue.js) | **Typed** (`aura-vue.d.ts`, #548) | `isAuraElement` compiler predicate so Vue treats `aura-*` as custom elements; `@event` binding then works natively, plus an `AURA_TAGS` list for tooling. The generated [`vue/aura-vue.d.ts`](vue/aura-vue.d.ts) types those exports AND augments the `vue` module's `GlobalComponents` so every `aura-*` tag gets per-element attribute typing + IntelliSense in templates. **Per-element attribute *checking* (rejecting a typo) requires the consumer to enable `vueCompilerOptions.strictTemplates`** — without it Vue allows arbitrary attributes on custom-element tags and the typing is advisory; with it, `vue-tsc` rejects `<aura-button varient="…">` (gated by `tests/vue-svelte-templates/`, #595). It also exports the same generated event-detail interfaces (`AuraChangeDetail`, …) + an `AuraEventMap` as React/Svelte, and mixes typed `onAura:*` listener props into `GlobalComponents` so a `@aura:change` handler narrows `$event.detail` without a cast (#709). |
| Svelte | [`svelte/aura-svelte.js`](svelte/aura-svelte.js) | **Typed** (`aura-svelte.d.ts`, #548) | A `use:events` action for declaratively forwarding (colon-named) custom events; re-exports `AURA_TAGS` from its OWN sibling [`svelte/aura-tags.generated.js`](svelte/aura-tags.generated.js) (a byte-identical copy the generator emits alongside the Vue one — #660) and owns its own `isAuraElement` — it contains NO `../vue/` import path, so vendoring only `bindings/svelte/` works with no Vue adapter files present (#608/#660). Supported range: **Svelte 4 and 5** — on Svelte 5 use `onclick` for native events and `use:events` for Aura's colon-named custom events (the `on:` directive is the legacy Svelte 4 path) (#577). The `use:events` action is **strictly typed per event** — `e.detail` narrows to the right `…Detail` and a typo'd field errors under `svelte-check` (#612, gated by `tests/vue-svelte-templates/`). The generated [`svelte/aura-svelte.d.ts`](svelte/aura-svelte.d.ts) also augments `svelteHTML.IntrinsicElements` with every `aura-*` tag's attributes for IntelliSense; **however, attribute *checking* in `.svelte` markup is NOT enforced** — Svelte's own typings give every hyphenated custom element a `[name: string]: any` catch-all (`svelte/elements.d.ts`), so `svelte-check` cannot reject a typo'd attribute on `<aura-* …>` the way `vue-tsc` does. The attribute types are IntelliSense-only on the Svelte markup side. |

The package entry itself — `import "@aura-design/core"` — also carries
ambient types (`dist/aura.d.ts`) via the `.` export's `types` condition, so a
TypeScript consumer loading the runtime for its side effect gets no
implicit-any (#471). The exported interfaces include:

| Interface | Members |
|---|---|
| `AuraGlobal` | `debug`, `refresh`, `ready`, `onMount`, `define`, `nextId`, `env`, `toast`, `theme`, `dialog`, `tooltip`, `menu`, `formGuard`, `copy`, `color`, `format`, `entrance`, `tokens`, `shell`, `form`, `scrollRootFor` |
| `AuraThemeAPI` | `setPrimary`, `setSecondary`, `setMode`, `setWallpaper`, `setTheme`, `pin`, `apply`, `persist`, `registerTheme`, `suggestPalette` |
| `AuraToastOptions` | `message`, `variant` (`"info" \| "success" \| "warning" \| "danger" \| "notification"`), `duration`, `onClose` |
| `AuraDialogAPI` | `open(selectorOrEl, opener?)`, `close(selectorOrEl)`, `closeAll()`, `isOpen(selectorOrEl)` → `boolean` |
| `AuraTooltipAPI` | `show(trigger)`, `hide()`, `attach(el, text)` |
| `AuraMenuAPI` | `open(selectorOrEl, x, y)`, `openAtAnchor(selectorOrEl, anchorEl, opener?)`, `closeAll()`, `openCount()` |
| `AuraFormGuardAPI` | `isDirty(form)`, `anyDirty()`, `markDirty(form)`, `clear(form)` |
| `AuraCopyAPI` | `copyText(text)` → `Promise<boolean>`, `textFor(trigger)`, `injectCodeButtons(root?)`, `announce(message?)` |
| `AuraColorAPI` | `RGB_MAX` (255), `HUE_MAX` (360), `PCT_MAX` (100), `clamp(n,min,max)`, `hexToRgb`, `rgbToHex`, `hslToRgb`, `rgbToHsl`, `rgbToOklch`, `oklchToRgb`, `relLuminance`, `contrast`, `parseColor`, `formatColor` |
| `AuraFormatAPI` | `number`, `currency`, `percent`, `compact`, `placeholder` |
| `AuraEntranceAPI` | `replay(root?)` — replay entrance choreography, chainable |
| `AuraTokenModelAPI` | `link`, `unlink`, `isLinked`, `source`, `links`, `applyLinked`, `setSource`, `detach` |
| `AuraShellAPI` | `open(shellEl)`, `close(shellEl)`, `toggle(shellEl)`, `isOpen(shellEl)` |
| `AuraFormAPI` | `refresh(root?)` — re-scan `<aura-form>` elements |

`window.Aura` is typed as `AuraGlobal | undefined` (present only after the
runtime loads). All named members above are typed on the interface rather than
the escape-hatch index signature, so IDE auto-complete and compile-time argument
checking apply. `env.reducedMotion()` and `env.coarsePointer()` are also typed as live-boolean functions.

## CSS-class component wrappers (React)

Some Aura components are not custom elements — they are plain HTML elements
that Aura's CSS and JavaScript enhance based on class names or attributes.
The auto-generated `aura-react.js` wrappers only cover registered custom
elements; for the CSS-class pattern, hand-authored thin wrappers live in
`bindings/react/css-class-wrappers.js`.

| Component | Wraps | Skip rationale |
|---|---|---|
| `AuraSidebar` | `.aura-sidebar[data-aura-sidebar="reveal"]` | — |
| `AuraDisclosure` | `<details class="aura-disclosure">` | — |
| `AuraAlert` | `.aura-alert[data-variant?]` | — |
| `AuraCopyButton` | `.aura-copy[data-aura-copy]` | — |
| `AuraTableWrap` | `.aura-table-wrap[tabindex="0"][role="region"][aria-label="…"]` | — |
| `AuraTable` | `<table class="aura-table [aura-table--sticky-head]">` | — |
| `AuraSkeleton` | `<span class="aura-skeleton [aura-skeleton--{variant}] [aura-skeleton--short]">` | — |
| `AuraSkeletonGroup` | `<div class="aura-skeleton-group">` | — |
| `aura-region` | — | CSS block element, no required attributes; `<aura-region>` works natively in JSX |
| `aura-accordion` | — | Not a standalone CSS pattern; accordion UIs are composed from multiple `<AuraDisclosure>` elements |

Import:
```js
import {
  AuraSidebar,
  AuraDisclosure,
  AuraAlert,
  AuraCopyButton,
  AuraTableWrap,
  AuraTable,
  AuraSkeleton,
  AuraSkeletonGroup,
} from "@aura-design/core/bindings/react/css-class-wrappers";
```

## Hooks quick reference (React)

All hooks are exported from `@aura-design/core/bindings/react/hooks`. Import
only what you need — each hook is standalone and tree-shakeable.

```js
import { useAuraTheme, useAuraDarkMode } from "@aura-design/core/bindings/react/hooks";
```

### Theme and appearance

| Hook | Signature | What it does |
|---|---|---|
| `useAuraTheme` | `(defaultTheme?: string) → [theme, setTheme]` | Read/set the active dark/light/auto mode (`data-aura-theme`). Persists to `localStorage` in the same format as `Aura.theme.persist()`. |
| `useAuraThemeName` | `(defaultName?: string) → [name, setName]` | Read/set the active named theme (default/warm-dusk/frutiger-aero/aqua-aero/flat-primary/retro-pc/extra-depth/modern-flat). Persists to `localStorage`. |
| `useAuraDarkMode` | `() → { isDark, toggle, setDark }` | `isDark` is `true` when the resolved mode is dark (respects auto→OS preference; returns `false` during SSR). `toggle()` flips between dark/light; `setDark(v)` sets it explicitly. |
| `useAuraAccentColor` | `() → [hex, setHex]` | Read/set the primary accent colour (`--aura-primary`) at the `<html>` level. |
| `useAuraSecondaryColor` | `() → [hex, setHex]` | Read/set the secondary accent colour (`--aura-secondary`) at the `<html>` level. |
| `useAuraSuggestPalette` | `(primary: string) → { secondary } \| null` | Memoised OKLCH 180° complement of `primary` via `Aura.theme.suggestPalette`. Returns `null` during SSR or when the Aura colour module is absent. |

### Tokens

| Hook | Signature | What it does |
|---|---|---|
| `useAuraTokens` | `() → Record<string, string>` | The full resolved token map from `dist/aura-tokens.js`. Re-renders on named-theme change via a `MutationObserver`. |
| `useAuraCSSToken` | `(property: string) → string` | Reads a single CSS custom property live from `<html>` via `getComputedStyle`. Returns `""` during SSR/before first mount. |

**Static token imports** (no hook needed):

`dist/aura-tokens.js` also exports two plain objects for use in bundler code (SSR-safe, no hooks):

- `auraTokens` — resolved values: `{ accent: "rgb(118, 84, 245)", bg: "rgb(10, 11, 18)", … }` — safe to use for non-themed computations (e.g., snapshot tests, SSR renders).
- `auraTokenVars` — CSS custom property references: `{ accent: "var(--aura-accent)", bg: "var(--aura-bg)", … }` — compose into `style={{}}` objects so your inline styles respect the live theme.

```tsx
import { auraTokenVars } from "@aura-design/core/tokens";

// Inline style that respects the live named theme (retro-pc, warm-dusk, etc.)
<div style={{ backgroundColor: auraTokenVars.bg, color: auraTokenVars.text }}>…</div>
```

Use `auraTokenVars` over hardcoded `var(--aura-accent)` strings so your code benefits from the TypeScript token-key autocomplete that the `.d.ts` declaration provides.

### Utilities

| Hook | Signature | What it does |
|---|---|---|
| `useAuraMotion` | `() → boolean` | `true` when `prefers-reduced-motion: reduce` — motion should be suppressed; `false` means animations are safe. |
| `useAuraMediaQuery` | `(query: string) → boolean` | Reactive `window.matchMedia` wrapper. Stable across SSR (returns `false` before mount). |
| `useAuraEvent` | `(ref, eventName, handler) → void` | Attaches an `aura:*` custom-event listener on `ref.current` with stable listener identity across renders. |

### Actions

| Hook | Signature | What it does |
|---|---|---|
| `useAuraToast` | `() → { showToast }` | `showToast(string \| AuraToastOptions)` calls `Aura.toast()` imperatively. SSR-safe (no-ops on the server). |

### Component control

| Hook | Signature | What it does |
|---|---|---|
| `useAuraDialog` | `(ref) → { isOpen, open, close }` | Open/close an `<AuraDialog>` element; `isOpen` syncs from `aura:dialog-open`/`aura:dialog-close` events — ESC, scrim, and close-button dismissals are all auto-reflected. |
| `useAuraTabs` | `(ref) → { activeIndex, activeTab, activePanelId, selectTab }` | Track the active tab index (0-based), active tab element, and active panel ID in an `<aura-tabs>` container via `aura:tab-change` events. `activeTab` is the currently-selected `<aura-tab>` element (`null` until first event). `activePanelId` is the `aria-controls` value of the active tab (the `<aura-tabpanel>` ID). `selectTab(i)` programmatically activates tab `i`. |
| `useAuraMenu` | `(ref) → { isOpen, openAtAnchor, closeAll, selection }` | Track `<aura-menu>` open state via `MutationObserver` on the `aura-menu--open` class. `openAtAnchor(anchorEl)` positions and opens the menu below a trigger. `selection` holds the last `aura:menu-select` payload `{ value, label, checked, action }` (`null` before first pick). |
| `useAuraSplit` | `(ref) → { ratios }` | Track live panel size ratios (fr values, sum = 100) from an `<aura-split>` element via `aura:change` events. Seeded from the element's `ratios` getter on mount; `[]` only before the element connects. |

**`useAuraMenu` example** — a "⋯" button anchoring a rich `<aura-menu>` via
the hook's imperative `openAtAnchor`, as an alternative to the declarative
`data-aura-menu` + `data-aura-menu-trigger="click"` attribute pair:

```jsx
import { useRef } from "react";
import { AuraButton } from "@aura-design/core/bindings/react";
import { useAuraMenu } from "@aura-design/core/bindings/react/hooks";

function RowActions() {
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const { isOpen, openAtAnchor, selection } = useAuraMenu(menuRef);

  return (
    <>
      <AuraButton ref={triggerRef} onClick={() => openAtAnchor(triggerRef.current)}>
        ⋯
      </AuraButton>
      <aura-menu ref={menuRef} id="row-menu" hidden>
        <aura-menu-item icon="edit">Edit</aura-menu-item>
        <aura-menu-item icon="copy">Duplicate</aura-menu-item>
        <aura-menu-item icon="trash" variant="danger">Delete</aura-menu-item>
      </aura-menu>
      {selection && <p>Last pick: {selection.label}</p>}
    </>
  );
}
```

`isOpen` is handy for driving a `⋯` button's `aria-expanded`; `selection`
updates on every `aura:menu-select` so you don't need a separate event
listener.

### Picker state

| Hook | Signature | What it does |
|---|---|---|
| `useAuraDatePicker` | `(ref) → { value, date, label, start, end }` | Track the selected value of an `<aura-datepicker>` via `aura:change` events. Single mode: `value` = ISO string, `date` = `Date`, `label` = display string. Range mode: `value` = `"start/end"`, `start`/`end` = ISO strings. `value` is seeded from the `value` attribute on mount; `null` only during SSR. |
| `useAuraTimePicker` | `(ref) → { value }` | Track the selected time from an `<aura-timepicker>` via `aura:change`. `value` is a time string (e.g. `"14:30"`), seeded from the `value` attribute on mount; `null` only during SSR. |
| `useAuraColorPicker` | `(ref) → { value, rgb, hsl, oklch, alpha }` | Track the selected colour from an `<aura-color-picker>` via `aura:change`. `value` = hex string (seeded from `value` attribute on mount; `null` only during SSR). `rgb` = `{ r, g, b }` (0–255), `hsl` = `{ h, s, l }`, `oklch` = `{ l, c, h }`, `alpha` = 0–1. All fields are seeded on mount via `Aura.color.parseColor()`; `null` only during SSR. |

### Form and editor state

| Hook | Signature | What it does |
|---|---|---|
| `useAuraForm(ref)` | `(ref) → { managed, dirty, clearDirty }` | form-wide change count and dirty flag; `dirty` seeded from `data-aura-dirty` on mount; `clearDirty()` resets state and calls `Aura.formGuard.clear()` |
| `useAuraEditor(ref)` | `(ref) → { html, text }` | rich-text content; seeded from `getHTML()`/`getText()` on mount, updates on every user edit; `null` only during SSR |

### Input event hooks

| Hook | Element | Returns |
|---|---|---|
| `useAuraSwitch(ref)` | `aura-switch` | `{ checked, toggle() }` — `checked` seeded from attribute on mount; `toggle()` flips the switch programmatically and fires `aura:change` |
| `useAuraCheckbox(ref)` | `aura-checkbox` | `{ checked, indeterminate, value }` — seeded from attributes on mount; `null` only during SSR |
| `useAuraSelect(ref)` | `aura-select` | `{ value, label, multiple }` — `value` seeded from attributes on mount; `null` only during SSR |
| `useAuraStepper(ref)` | `aura-stepper` | `{ value }` — seeded from `value` attribute on mount; falls back to `min` attr (default 0) when unset; `null` only during SSR |
| `useAuraRange(ref)` | `aura-range` | `{ value }` — single mode: number seeded from `value` attr or `min` (default 0); dual mode: `[lo, hi]` from `"lo,hi"` attr or `[min, max]`; `null` only during SSR |
| `useAuraCopy(ref)` | any copy-button container | `{ text, copy(str) }` — `text` is the last-copied string (`null` before first copy); `copy(str)` imperatively writes to the clipboard via `Aura.copy.copyText()` and returns `Promise<boolean>` |
| `useAuraFooter(ref)` | `aura-footer` | `{ revealed }` — seeded from `data-aura-revealed` attribute on mount; `null` only during SSR |
| `useAuraNavPanel(ref)` | `aura-nav-header` | `{ trigger: HTMLElement \| null }` — element that last opened a nav panel; `null` before first open |
| `useAuraTagInput(ref)` | `aura-tag-input` | `{ tags, addTag, removeTag }` — seeded from `value` attribute on mount; `addTag(v)` and `removeTag(i)` delegate to the element's dedupe-aware methods; `null` only during SSR |
| `useAuraRadio(ref)` | `aura-radio` | `{ checked, value }` — seeded from element attributes on mount; `null` only during SSR |

## Generated vs hand-authored (React)

The React binding is split, and only PART of it is machine-generated (#521):

- **Generated** by `tools/aura_react.py` from the element registry (`js/*.js`)
  — regenerated by `just react` (inside `just build`) and drift-gated by
  `just react-check` (inside `just check`): `aura-react.js`, `aura-react.d.ts`,
  `jsx.d.ts`. **Do not hand-edit these** — edit the generator and rerun.
- **Hand-authored** — `hooks.js` and `hooks.d.ts`. They are *not* emitted by
  the generator and have no regenerate step; edit them directly. A light gate
  (`tools/test_aura_tools_producer.py`) checks that the two stay in sync (every hook
  exported from `hooks.js` is declared in `hooks.d.ts` and vice versa).

The **Vue/Svelte** `AURA_TAGS` list is likewise generated — the same
`tools/aura_react.py` run emits a byte-identical `aura-tags.generated.js` into
BOTH `vue/` and `svelte/` from one renderer (from the same registry the React
codegen validates against — #660). Each adapter re-exports its OWN sibling copy
(`aura-vue.js` from `./aura-tags.generated.js`, `aura-svelte.js` likewise), so
neither cross-imports the other's directory and each is vendorable standalone
(#608/#660). The drift gate (`just react-check`) fails the build if either copy
diverges from `js/` (#514).

The **Vue/Svelte type surfaces** — `vue/aura-vue.d.ts` and
`svelte/aura-svelte.d.ts` — are ALSO generated by `tools/aura_react.py` from the
same `ELEMENTS` table that feeds the React `jsx.d.ts` (#548), so the three
frameworks' typed element vocabularies can never drift. **Do not hand-edit
them** — edit the generator and rerun. The same `just react-check` drift gate
covers them, and three consumer-vantage gates (all in `just check-react`) prove
the typed-template promise:

- `tests/vue-svelte-types/run.sh` compiles the exported attribute vocabulary
  against plain TypeScript plus an expect-fail typo case (no framework runtime).
- `tests/vue-svelte-templates/run.sh` (#595) compiles a real `.vue` through
  **`vue-tsc`** (under `vueCompilerOptions.strictTemplates`) and a real `.svelte`
  through **`svelte-check`**, with an expect-fail per framework: `vue-tsc` rejects
  a typo'd attribute in `<aura-button …>` markup (the GlobalComponents
  augmentation validated through Vue's real type machinery), and `svelte-check`
  rejects a typo'd `use:events` event-detail field (#612). It honestly does NOT
  assert Svelte markup attribute checking, because Svelte's `[name: string]: any`
  custom-element catch-all makes that unenforceable (see the Svelte row above).
- `tests/vue-svelte-resolve/run.sh` (#629) resolves AND imports the published
  `@aura-design/core/bindings/{vue,svelte}` specifiers so the `exports` entries
  are guarded like the React ones.

## Vue 3

Install and load exactly as shown in `docs/quickstart.md`. Two files ship in
`bindings/vue/`:

| File | What it does |
|---|---|
| `aura-vue.js` | Exports `isAuraElement` (custom-element guard), `AURA_TAGS` (the tag set), and a plugin object |
| `aura-tags.generated.js` | Generated per-element attribute maps — imported automatically via `aura-vue.d.ts` |

**Typed template attributes (IntelliSense + checking):**

`aura-vue.d.ts` augments Vue's `GlobalComponents` registry so every `<aura-*>`
tag gets per-attribute IntelliSense. Attribute *checking* (rejecting a typo like
`variat=`) also requires:

```js
// vite.config.js
import vue from "@vitejs/plugin-vue";
import { isAuraElement } from "@aura-design/core/bindings/vue";
export default {
  plugins: [vue({ template: { compilerOptions: { isCustomElement: isAuraElement } } })],
};
```
```json
// tsconfig.json
{
  "vueCompilerOptions": { "strictTemplates": true }
}
```

Without `strictTemplates: true`, Vue accepts arbitrary attributes on custom
elements — the typing becomes advisory IntelliSense only, not enforced.

**Typed `@aura:change` events:**

Each element's `@aura:change` handler receives a narrowed event type via the
generated `GlobalComponents` augmentation. Example for `aura-select`:

```vue
<aura-select @aura:change="e => (selected = e.detail.value)" />
```

`e.detail` is typed as `{ value: string; label: string; multiple: boolean }` —
no casting needed when `strictTemplates` is on.

---

## Svelte

Install and load exactly as shown in `docs/quickstart.md`. Three files ship in
`bindings/svelte/`:

| File | What it does |
|---|---|
| `aura-svelte.js` | Exports `isAuraElement`, `AURA_TAGS`, and `events` action |
| `aura-svelte.d.ts` | Declares global `aura-*` element attribute types for Svelte templates |
| `aura-tags.generated.js` | Generated per-element event and attribute maps |

**The `use:events` action** is the standard way to bind colon-namespaced events
(`aura:change`, `aura:dialog-open`, etc.) because Svelte's `on:` directive does
not forward colons to the DOM:

```svelte
<script>
  import { events } from "@aura-design/core/bindings/svelte";
  let value = "";
</script>

<aura-select {value}
  use:events={{ "aura:change": e => (value = e.detail.value) }}
/>
```

On **Svelte 4** the `on:aura:change` directive also works. On **Svelte 5**
the `on:` directive for custom events is legacy — prefer `use:events`.

**Typed event detail:** the generated `aura-svelte.d.ts` narrows the event
detail per element, matching the same `AuraChangeDetail` types the React
bindings expose. `e.detail.value` on `<aura-select>` is `string`, not `any`.

---

## Typed event utilities — `AuraEventName` and `AuraEventMap`

All three framework bindings export two shared types:

- **`AuraEventMap`** — a record mapping every Aura event name (e.g. `"aura:change"`, `"aura:dialog-open"`) to its `CustomEvent` detail type.
- **`AuraEventName`** — `keyof AuraEventMap` — the union of all valid Aura event name strings.

Use `AuraEventName` to type a generic listener helper without hardcoding the literal:

```ts
import type { AuraEventName, AuraEventMap } from "@aura-design/core/bindings/react";

function onAura<K extends AuraEventName>(
  el: Element,
  name: K,
  fn: (e: AuraEventMap[K]) => void
): void {
  el.addEventListener(name, fn as EventListener);
}

// TypeScript narrows e.detail to the correct type for the event name:
onAura(mySelect, "aura:change", (e) => {
  const selected: string = e.detail.value; // no cast needed
});
```

The same types are available from the Vue and Svelte bindings under the same names.

**`AuraEventHandlers` — the escape hatch for consumer-defined events.** The `events` prop on each wrapper is a *closed* map — only the events that element actually dispatches type-check, so a typo like `"aura:chnge"` is a compile-time error rather than a silent no-op. When you need to attach a consumer-defined event or a future Aura event that isn't in the current closed set, use the `AuraEventHandlers` type to widen explicitly:

```tsx
import type { AuraEventHandlers } from "@aura-design/core/bindings/react";

<AuraSelect
  events={{
    "aura:change": (e) => setVal(e.detail.value),
    // Add a custom event alongside the typed ones:
    "my-app:my-custom-event": (e) => handleCustom(e),
  } as AuraEventHandlers}
/>
```

**Extending `AuraEventMap` via declaration merging.** If your project fires `my-app:*` events from Aura elements and you want them to type-check everywhere (not just with the escape hatch), add a declaration-merge file:

```ts
// src/aura-events.d.ts
import "@aura-design/core/bindings/react";

declare module "@aura-design/core/bindings/react" {
  interface AuraEventMap {
    "my-app:my-custom-event": CustomEvent<{ id: string }>;
  }
}
```

After this merge, `"my-app:my-custom-event"` is a valid key in `AuraEventName`, `AuraEventHandlers`, and `useAuraEvent`.

---

## Module format — ESM only

This package is **ESM-only** (`"type": "module"`). Every `exports` condition
resolves to an ES module (`import`/`default`); there is intentionally **no
`require` condition** (#516): the files are ESM, so a `require()` of them on
Node < 22 would throw `ERR_REQUIRE_ESM` — a dishonest `require` mapping was
removed in v3.27 rather than point at a file Node cannot `require`. The
`types` condition sits beside `import`/`default` in each entry, so a
`moduleResolution: node16`/`nodenext` consumer gets an unambiguous ESM result
with matching types. Consume the bindings from an ESM graph (`import`), Node
ESM, or any bundler; a CommonJS (`require`) graph is not supported — interop
through your bundler or a dynamic `import()` instead.

## RSC / React Server Components

All Aura React wrappers (`AuraButton`, `AuraEditor`, etc.) and hooks (`useAuraTheme`,
`useAuraTokens`, etc.) are **client components** — they use `useEffect`,
`useLayoutEffect`, and `useRef`, and register or interact with custom elements that
only exist in the browser. Both `bindings/react/aura-react.js` and
`bindings/react/hooks.js` carry the `"use client"` directive on their first line.

### Next.js App Router

- If your own component imports from `@aura-design/core/bindings/react`, mark that
  file with `"use client"` at its top. The directive propagates — any module that
  imports a `"use client"` module is itself treated as a client boundary.
- For overlay or picker components that must never render on the server (e.g.
  `AuraColorPicker`, `AuraDatepicker`), use `next/dynamic` with `{ ssr: false }`:
  ```js
  import dynamic from "next/dynamic";
  const AuraColorPicker = dynamic(
    () => import("@aura-design/core/bindings/react").then(m => m.AuraColorPicker),
    { ssr: false }
  );
  ```

### Plain custom-element runtime and SSR

The plain Aura runtime (`@aura-design/core/dist/aura.js`, without React bindings)
is **SSR-import-safe**: every module guards browser-global access so the bundle
evaluates cleanly in a DOM-less Node environment. This guarantee is enforced by the
`check-ssr` gate (`just check-ssr`). However, custom-element registration is still
browser-only — the runtime's `define()` calls are no-ops on the server, so elements
become interactive only after the client-side hydration pass loads the runtime.

## Why wrappers are thin

Custom elements already are the cross-framework component model. The only real
friction is **custom events** (e.g. `aura:change`) and, for React ≤18,
property-vs-attribute handling — which is exactly what these adapters smooth
over. Nothing here reimplements component behaviour; the element does the work.

## Full element API — the catalog

The TypeScript `*Props` interfaces in `aura-react.d.ts` cover every prop these
wrappers accept. For the **underlying element's full runtime API** (imperative
methods, ARIA slots, CSS custom properties, HTML attributes not surfaced as
typed props), see the live **element catalog** at [`demo/index.html`](../demo/index.html)
— each catalog entry documents the element's full surface. This is the
authoritative reference; the React props are a typed subset of the element's
attribute surface.

## Common React gotchas

**`class` not `className`.** Aura wrappers expose a `class` prop (not
`className`) because they forward it straight to the underlying HTML attribute.
At runtime the wrapper accepts both — `className` wins when both are passed —
but the TypeScript types only declare `class`, so `className` produces a type
error. Use `class` for type-safe code:

```tsx
// Correct — typed and forwards to the element attribute.
<AuraButton class="my-btn">Save</AuraButton>

// Also works at runtime, but triggers a TS type error.
<AuraButton className="my-btn">Save</AuraButton>
```

**`onChange` is a type error.** React's synthetic `onChange` never fires on a
custom element. Use the `events` prop instead:

```tsx
// Wrong — silently does nothing on a custom element.
<AuraSelect onChange={(e) => …} />

// Correct — fires the native aura:change custom event.
<AuraSelect events={{ "aura:change": (e) => setVal(e.detail.value) }} />
```

---

## Non-goals

- A separate React/Vue/Svelte component *implementation* (the web component IS
  the implementation).
- Bundling the runtime into the binding (keeps versions independent — point both
  at the same Aura release).
