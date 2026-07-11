---
source: release-asset
source-url: https://github.com/rhohn94/design-language
source-sha: "d389da5cbabb1a4ee08834f2066b4631c867663b"  # release v3.541.0 git_sha (vendor.lock)
source-pin: "v3.541.0"  # stable release channel; channel-vendored via vendor.toml [deps.aura]
adaptation-status: draft
---

# UX Design Language — Harmony

> **Up:** [↑ UX](README.md)

> **Status:** D3 deliverable. The project-specific Aura adaptation for Harmony
> v0.1. Implements the **Aura-in-React seam** of the master contract
> ([../architecture-design.md §5.2](../architecture-design.md)). The screen
> inventory that consumes this language lives in
> [../harmony-ux-design.md](../harmony-ux-design.md).

## Motivation

Harmony is built by ~20 parallel work-item agents (W13 library, W14 controller,
W15 settings, W16 cores, W17 search, …). Without a single, fixed visual language
each would re-invent panels, focus rings, spacing, and theming, and the merged
app would look incoherent. This doc fixes Harmony's adoption of the **Aura**
design language: how Aura is vendored and imported, the brand-knob values, the
anti-FOUC strategy, the archetype→screen map, and the documented friction of
driving Aura's web components from React 19. Every UI agent reads this before
building a screen.

## Scope

**Covered:** the Aura source pin + submodule path + how `bindings/react` is
imported; the 3-knob OKLCH brand values and dark surface tokens chosen for
Harmony; the anti-FOUC head script; the Aura-archetype → Harmony-screen mapping;
the Aura-in-React friction findings (ecosystem signal); and how Aura translucency
cooperates with the native-vibrancy seam.

**Not covered:** per-screen layout sketches, controller-navigation maps, and
Framer Motion transition choreography — those live in
[../harmony-ux-design.md](../harmony-ux-design.md). Vibrancy config keys + the
pre-blur pipeline live in `native-vibrancy-design.md` (D2, not yet merged).

---

## 1. What Aura is

Aura (`@aura-design/core`) is a web-component design system:

- **`<aura-*>` custom elements** — `<aura-app>`, `<aura-card>`, `<aura-grid>`,
  `<aura-button>`, `<aura-field>`, `<aura-list>`, `<aura-dialog>`, `<aura-tabs>`,
  `<aura-nav>`, etc.
- **BEM classes** for variants/modifiers (`aura-card aura-card--elevated`).
- **A `css/aura.css` @layer barrel** — Aura styles live in CSS cascade layers so
  app overrides can win deterministically by layer order.
- **8 page archetypes** — ready-made full-page compositions (see §5).
- **An official `bindings/react`** — typed React wrappers, hooks, and a
  `jsx.d.ts` ambient declaration that types the custom elements for TSX.

Harmony uses Aura as its **only** design language. **No Tailwind.** Framer Motion
handles transitions on top of Aura.

---

## 2. How Harmony consumes Aura (source pin + submodule + import)

### 2.1 The known upstream gap (design-language#858)

Aura's **v3.20 release asset bundle** ships `css/`, `js/`, `dist/`, and
`templates/` — but it **does NOT include `bindings/react`**. The official React
adapter exists only in the **repo tree** (and on unreleased `vX.Y.Z` tags). This
is filed upstream as **design-language#858**. Consequently Harmony **cannot** get
the React adapter from a package/asset install.

### 2.2 Resolution — git submodule pin

Harmony consumes Aura via a **git submodule pin** of `rhohn94/design-language`,
so the full source tree — including `bindings/react` — is present in-repo.

- **Submodule path: `vendor/aura`** (chosen; stated here as the canonical path so
  W2/W19 agree). Resolves to `…/design-language` checked out at the pinned SHA.
- **Pinned ref:** `v3.20` is the **stable release channel**. Bare `v3.446`-style
  tags carry **no assets** and are not used as the Harmony pin.
- **Pinned SHA:** `83c50b3fa0014433abd0ce783ae5911b8a29f1d4` — pinned by **W2** on
  the `v3.20` channel; this doc's front-matter `source-sha` is updated in the same
  change. W19 reconciles this submodule pin with the Dependency Channel /
  `vendor.toml` (see [../dependency-channel-conformance.md](../dependency-channel-conformance.md)).

```
git submodule add https://github.com/rhohn94/design-language vendor/aura
git -C vendor/aura checkout <PINNED_SHA on v3.20 channel>   # W2
```

### 2.3 Import strategy

Vite aliases let app code import the React adapter from the vendored tree
(`vendor/aura`, the Dependency Channel asset bundle — §2.2). The `@aura/*`
alias map is single-sourced in `vite/aura-aliases.ts` (a shared module, not a
`.d.ts`); both `vite.config.ts` (dev server + build) and `vitest.config.ts`
(unit tests, so a `.tsx` spec importing an Aura-backed component resolves the
same way it does in the app build) import `auraAliases` from it and pass it
straight through as `resolve.alias`, so there is no hand-kept mirror to drift:

```ts
// vite/aura-aliases.ts
export const auraAliases: Record<string, string> = {
  // Longest-prefix alias FIRST: plugin-alias matches "@aura/react" as a
  // path-segment prefix of "@aura/react/hooks" too, so the hooks entry
  // must be listed before the bare "@aura/react" one or it never wins.
  "@aura/react/hooks": resolveVendored("vendor/aura/bindings/react/hooks.js"),
  "@aura/react":       resolveVendored("vendor/aura/bindings/react/aura-react.js"),
  "@aura/css":         resolveVendored("vendor/aura/css"),
  "@aura/runtime":     resolveVendored("vendor/aura/dist/aura.js"),
};
```

```ts
// vite.config.ts / vitest.config.ts
import { auraAliases } from "./vite/aura-aliases";
// ...
resolve: { alias: auraAliases },
```

```ts
// src/theme/AuraProvider.tsx  (D3/W2)
import "@aura/css/aura.css";              // the @layer barrel
import { AuraApp, AuraCard, AuraButton } from "@aura/react";
```

**Types (W396, closes design-language#40).** `tsconfig.json`'s `paths` maps
`@aura/react` straight to the vendored, **generated** types —
`vendor/aura/bindings/react/aura-react.d.ts` (v3.541.0 ships real types now;
§7.1) — and `@aura/react/hooks` to the sibling `hooks.d.ts`, so both the
typed wrappers (`AuraButtonProps`, `AuraDialogProps`, …) and the ~30 upstream
hooks (`useAuraDialog`, `useAuraTheme`, …) resolve with their real, generated
shapes. There is no per-project shim left for either surface — the former
hand-rolled `src/theme/aura-react.d.ts` (which typed every component as a
generic `AuraComponent` with `[attr: string]: unknown`) is deleted outright;
nothing in the app depended on its `createAuraComponent`/`AuraWrapperProps`
exports beyond the 5 typed wrappers actually used (`AuraApp`, `AuraButton`,
`AuraCard`, `AuraField`, `AuraDialog`), and those all type-check unmodified
against the real generated props. Adopting a specific hook is **not**
required by this wiring — the alias only needs to resolve;
`src/theme/auraReactHooks.test.ts` proves both the Vite/Vitest bundler alias
and the tsconfig `paths` entry resolve, without exercising hook behavior.

`src/theme/aura.d.ts` is now much smaller: it covers only the two ambient
declarations that have no upstream `.d.ts` because they are app-local Vite
aliases, not part of Aura's published type surface — the `@aura/runtime`
side-effect import and the `@aura/css/*` CSS-barrel import. Raw `<aura-*>` JSX
tags (if anything ever uses them — nothing in `src/` does today; every call
site goes through a typed wrapper) type-check via the vendored
`vendor/aura/bindings/react/jsx.d.ts` **without** a separate `tsconfig`
`include`/`types` entry: `aura-react.d.ts` carries
`/// <reference path="./jsx.d.ts" />` at its own top, and since `@aura/react`
resolves to that file for every wrapper import already in `src/`, `jsx.d.ts`
rides along transitively into the program. (§7.6 corrects the design's
original `include`/`types` claim, which this item found to be unnecessary in
practice.)

---

## 3. Brand knobs — the 3-knob OKLCH theming

Aura's brand is set by **three OKLCH custom properties**; everything else
(hover, borders, focus rings, on-surface text) derives from them. Harmony's vibe
is **cinematic, cover-art-forward, dark, premium** — a refined console dashboard
where the artwork is the hero and chrome recedes.

### 3.1 The three brand knobs

```css
:root,
.theme-harmony-noir {            /* default named theme */
  /* console-cyan primary: confident, electric, reads on near-black */
  --aura-primary:     oklch(0.78 0.15 215);   /* ~ cyan-teal accent */
  /* warm amber secondary: cover-art-friendly highlight / "play" energy */
  --aura-secondary:   oklch(0.80 0.13 65);    /* ~ warm amber */
  /* on-primary: near-black text/glyphs that sit ON the primary fill */
  --aura-on-primary:  oklch(0.18 0.01 230);
}
```

### 3.2 Dark surface tokens

Layered near-black surfaces give depth without competing with cover art. All are
defined as OKLCH so lightness steps are perceptually even.

```css
.theme-harmony-noir {
  /* surfaces, darkest → raised */
  --aura-bg:            oklch(0.16 0.012 250);   /* app backdrop (behind vibrancy) */
  --aura-surface:       oklch(0.20 0.014 250);   /* cards / shelves base */
  --aura-surface-raised:oklch(0.25 0.016 250);   /* hover / focused card */

  /* text */
  --aura-on-surface:        oklch(0.96 0.005 250);  /* primary text */
  --aura-on-surface-muted:  oklch(0.72 0.01 250);   /* captions, system labels */

  /* lines + focus */
  --aura-border:    oklch(0.32 0.012 250);
  --aura-focus:     var(--aura-primary);            /* focus ring uses brand cyan */

  /* TRANSLUCENT panel fills — see §6 (cooperate with native vibrancy) */
  --aura-panel-alpha:    oklch(0.20 0.014 250 / 0.62);
  --aura-shelf-alpha:    oklch(0.18 0.012 250 / 0.48);
}
```

### 3.3 Named themes

Dark is the **default**. Additional named themes are selected by swapping the
theme class on `<html>` (e.g. `theme-harmony-noir`, a lighter
`theme-harmony-dusk`). Each named theme re-declares the three brand knobs +
surface tokens; nothing else changes. The select lives in Settings → Appearance.

### 3.4 The Harmony token layer (v0.3 "Resonance")

Beyond the brand knobs and surfaces, Harmony's screens are driven by a small set
of `--harmony-*` tokens declared once at `:root` inside the `harmony-theme`
cascade layer (`src/theme/aura-theme.css`). These cover the values Aura's own
scale does not own, so components never hard-code a px/hex literal:

- **Geometry** — `--harmony-sidebar-width`, `--harmony-drag-strip-height`,
  `--harmony-traffic-light-inset`, hero/detail cover dimensions,
  `--harmony-tile-min-width`, `--harmony-detail-label-width`.
- **Off-scale spacing/radius** kept exact so v0.3 is visually identical to v0.2:
  `--harmony-section-gap` (20px), `--harmony-space-2-5` (10px),
  `--harmony-chip-pad` / `--harmony-chip-pad-sm`, `--harmony-radius-card` (10px),
  `--harmony-radius-cover` (14px).
- **Typography scale** — `--harmony-font-chip|caption|title|hero-title|detail-title`.
- **Focus ring** — `--harmony-focus-ring` + `--harmony-focus-ring-offset`, the
  single source shared by the library and cores screens.
- **Semantic alias** — `--aura-error: var(--aura-danger)`. Aura ships
  `--aura-danger`; Harmony's screens reference `--aura-error`, so the alias makes
  the error colour theme-driven instead of a hard-coded hex fallback.

**Rules.** Values that land exactly on Aura's 4px spacing scale or radius scale
use the Aura token directly (`--aura-space-*`, `--aura-radius-*`); only off-scale
values get a `--harmony-*` token. No `var(--aura-*, <literal>)` colour fallbacks
remain — every token resolves to a declared value. The
`scripts/token-adoption.test.mjs` guard enforces both invariants.

### 3.5 Motion (v0.4 "Motion")

Animation has a **single source split across two files** because Framer Motion
transitions are plain JS numbers (they cannot read CSS custom properties at
runtime):

- **`src/lib/motion.ts`** — the JS half. Exports durations (`DUR`), easings
  (`EASE_OUT`/`EASE_STANDARD`), named spring presets (`SPRING.gentle` →
  `.responsive` → `.snappy`), and shared variants (`pageTransition`,
  `listContainer`/`listItem`, `riseIn`, `dialogPop`). Components import these
  instead of hard-coding `stiffness`/`damping`/`duration` literals.
- **`src/theme/motion.css`** — the CSS half. `--harmony-dur-*` / `--harmony-ease-*`
  forward Aura's `--aura-dur-*` / `--aura-ease-*` primitives for CSS transitions,
  and it carries the **global `prefers-reduced-motion` rule**.

The duration/easing **numbers are mirrored** between the two files — keep them in
sync.

**Where motion lives.** Route changes crossfade (`AnimatePresence` `mode="wait"`
keyed by `location.pathname` in `App.tsx`); the library grid staggers in
(`listContainer` + `listItem` on `GameTile`); the hero, game-detail, cores
column, and core rows use the spring presets; the provider dialog pops in
(`dialogPop`); sidebar-nav, library tabs, and result rows transition on the fast
token.

**Reduced motion is honoured in exactly two places** — `<MotionConfig
reducedMotion="user">` wrapping the app (all Framer animation) and the global
media query in `motion.css` (all CSS transitions). Individual components no
longer carry their own reduced-motion media query. `scripts/motion.test.mjs`
guards that no raw spring/duration literal leaks outside `lib/motion.ts` and that
both reduced-motion hooks stay in place.

---

## 4. Anti-FOUC strategy

Aura's dark default + named-theme select must be applied **before first paint**,
or the user sees a flash of unthemed (light/transparent) content (FOUC) — which
on a transparent-vibrancy window looks especially broken.

A tiny **synchronous** head script sets the theme class on `<html>` from
persisted settings (or the dark default) before the React bundle and Aura CSS
load. It is inlined in `index.html` (not imported) so it runs first.

```html
<!-- index.html — runs before any CSS/JS bundle; D3, installed by main.tsx setup -->
<script>
  (function () {
    try {
      var t = localStorage.getItem("harmony.theme") || "theme-harmony-noir";
      document.documentElement.classList.add(t);
      document.documentElement.style.colorScheme = "dark";
    } catch (e) {
      document.documentElement.classList.add("theme-harmony-noir");
    }
  })();
</script>
```

`src/main.tsx` (architecture §1.1: "installs anti-FOUC theme (D3)") owns keeping
`localStorage["harmony.theme"]` in sync with the persisted `Settings` value so
the next cold start reads the correct theme. The script never blocks on IPC —
it reads only `localStorage`, with the dark default as the catch-all.

---

## 5. Aura archetype → Harmony-screen map

Aura ships **8 page archetypes**. Harmony's screens (architecture §1.1 screen
map) bind to them as follows. Layout sketches + controller nav live in
[../harmony-ux-design.md](../harmony-ux-design.md).

| Harmony screen | Route | Aura archetype | Why |
|---|---|---|---|
| Library grid + hero | `/` | **Gallery / Media-grid** | cover-art tiles in an `<aura-grid>` under a hero backdrop |
| Game detail | `/game/:id` | **Detail / Focus** | one hero subject + metadata column + primary action (Play) |
| Settings | `/settings` | **Settings / Sectioned-form** | left section nav + `<aura-field>` form panes (folders/cores/controllers/providers/Familiar) |
| Cores | `/cores` | **Management / Table-master-detail** | list of systems→cores with install/update/active actions |
| File search | `/search` | **Search / Query-results** | query field + provider-grouped results list (links only) |
| Controller hint bar | cross-cutting | **Shell / App-frame** (chrome region) | persistent `<aura-app>` footer/region for button hints |
| Focus/hint overlay | cross-cutting | **Overlay / Dialog** | transient command-hint + spatial-nav focus layer |

(Two archetypes — e.g. **Dashboard** and **Onboarding/Wizard** — are unused in
v0.1 and reserved for later: a fleet/status dashboard and a first-run setup
wizard. Recorded so later items know they are available.)

---

## 6. Translucency ↔ native-vibrancy cooperation

Harmony's window is a **transparent-vibrancy** window (architecture §5.1, D2):
macOS `NSVisualEffectView` paints the native blur **behind** the webview, and the
web layer must paint on a **transparent** background so the blur shows through.

**Rule:** Aura shelves/panels use **OKLCH-alpha** panel backgrounds
(`--aura-panel-alpha`, `--aura-shelf-alpha` in §3.2) so the native vibrancy reads
through them. There is **NO CSS `backdrop-filter`** anywhere — it is broken in a
transparent WKWebView (Tauri #12804). The "frosted" look comes entirely from the
**native** layer plus the Rust **pre-blurred-hero** handoff (`get_blurred_hero`,
architecture §2.6), which `HeroBackdrop` crossfades in. App-layer CSS only
controls the **alpha** of the surface fills, never a filter.

The body/`<aura-app>` root therefore declares a transparent background; only
cards, shelves, and the hint bar carry the semi-opaque OKLCH-alpha fills so
content stays legible over arbitrary cover art while vibrancy still shows at the
seams. Full vibrancy config + the transparent-webview CSS contract:
`native-vibrancy-design.md` (D2).

---

## 7. Aura-in-React friction findings (ecosystem signal)

Driving Aura's web components from React 19 surfaced real friction worth
recording for the ecosystem:

1. **`bindings/react` not in the release asset (design-language#858) —
   RESOLVED as of v3.541.0.** The original gap: the v3.20 asset bundle omitted
   the React adapter, so a clean package install yielded custom elements with
   **no** typed wrappers, no hooks, and no `jsx.d.ts`; Harmony's original
   workaround was a **submodule pin** (§2.2, historical). The v3.541.0 asset
   bundle now ships `bindings/react` complete with **generated** TypeScript
   types — `aura-react.d.ts`, `hooks.d.ts`, `jsx.d.ts` — which is what let W19
   migrate Harmony off the submodule onto the Dependency Channel asset bundle,
   and what let **W396** (design-language#40) repoint `tsconfig.json`'s
   `@aura/react`/`@aura/react/hooks` `paths` at the real generated types and
   delete the hand-rolled per-project shim outright (§2.3). Adopting them
   surfaced zero prop/event mismatches across the app's existing usage
   (`AuraApp`, `AuraButton`, `AuraCard`, `AuraDialog`, `AuraField`) — the shim
   and the real types happened to agree on every prop actually in use.

2. **`events`/`class` vs `onChange`/`className`.** Aura custom elements emit DOM
   **CustomEvents** and key off the **`class`** attribute. React's synthetic
   `onChange` does **not** fire for them, and React reserves `className`. Code
   must use the typed wrappers (which bridge to `addEventListener` + `class`) — or
   `ref` + `addEventListener` by hand. Mixing React idioms onto raw `<aura-*>`
   silently no-ops. This is the most common foot-gun for UI agents; the
   `theme/` + `components/` wrappers exist to hide it. Confirmed against the
   real wrapper source (W396): an explicit `className` is accepted too (it
   wins over `class` when both are set) and is bridged to a real `class="…"`
   attribute on every supported React version — so
   `<AuraApp className="rgp-shell">` (`src/App.tsx`) is correct as written,
   not an instance of this foot-gun.

3. **Controlled-input mismatch.** Because the change event isn't React's, the
   usual `value` + `onChange` controlled-component pattern doesn't apply
   directly to Aura's value-bearing elements. **Correction (W396):** the real
   generated types name the bridge prop `onChange` (not `onValueChange` as
   earlier drafts of this doc claimed — no such prop exists anywhere in the
   generated types or in this codebase), but its signature is the
   **controlled-bridge sugar** `(value, event) => void` — not a native
   `ChangeEvent` — reconciled from the element's `aura:change` CustomEvent
   internally. Only elements that actually carry a value declare it (e.g.
   `AuraCheckbox`, `AuraSelect`, `AuraRange`, `AuraSwitch`, `AuraStepper`);
   `<aura-field>` itself is a label/hint/error **wrapper**, not a value
   carrier — it has neither `value` nor `onChange`, and its wrapped child
   control carries the pair instead. `AuraSelect`/`AuraRange` additionally
   discriminate the pair on their `multiple`/`range` boolean prop via a typed
   union (`AuraSelectModeProps`/`AuraRangeModeProps`), so `value`/`onChange`
   narrow to `string`/`string[]` (or `number`/`number[]`) automatically —
   worth knowing before a future item adopts either component.

4. **SSR / hydration.** Custom elements are **client-only** in this app — Harmony
   is a Tauri SPA (no SSR), so hydration mismatch isn't a runtime risk here. But
   it is recorded as a portability caveat: `<aura-*>` elements are not defined
   until the Aura bundle's `customElements.define` runs, so any server-rendered
   markup would hydrate against undefined elements. For Harmony, importing the
   Aura CSS/JS barrel at app entry (before `<App/>` mounts) is sufficient.

5. **`@layer` ordering.** Aura's `css/aura.css` is a cascade-layer barrel. App
   overrides must be authored in a layer declared **after** Aura's, or use the
   provided override layer; otherwise specificity fights are unpredictable.
   Recorded so UI agents place overrides correctly.

6. **Type wiring — corrected (W396).** Earlier drafts of this doc claimed
   `jsx.d.ts` "must be in `tsconfig` `include`" for raw `<aura-*>` tags to
   type-check. In practice this was never wired up that way, and turns out to
   be unnecessary: `aura-react.d.ts` (the file `@aura/react`'s `paths` entry
   resolves to) carries `/// <reference path="./jsx.d.ts" />` at its own top,
   so once any file imports a wrapper from `@aura/react` — which every screen
   already does — `jsx.d.ts`'s global `JSX.IntrinsicElements` augmentation
   rides along transitively, no separate `include`/`types` entry needed.
   Verified empirically: a scratch raw `<aura-app bogusProp>` probe correctly
   failed `tsc` against the real generated `AuraAppElementAttributes`, proving
   the augmentation is live. One real hazard this surfaced:
   `src/theme/aura.d.ts` used to hand-roll its own `JSX.IntrinsicElements`
   entries for a 16-tag subset (`aura-app`, `aura-card`, …) as an app-local
   stand-in for the
   then-nonexistent real `jsx.d.ts`. With the real (55-tag) `jsx.d.ts` now
   live transitively, that hand-rolled block became dead, duplicate, and
   *structurally conflicting* (different prop shapes for the same tag names)
   — silently, because `tsconfig.json`'s pre-existing `skipLibCheck: true`
   suppresses exactly this class of cross-`.d.ts` inconsistency. No source
   file used a raw tag (every call site goes through a typed wrapper), so
   nothing broke, but it was a live landmine for the first future raw-tag
   consumer. W396 removed the dead block; `aura.d.ts` now declares only the
   two ambient module imports Aura's own types don't cover (`@aura/runtime`,
   `@aura/css/*` — both app-local Vite aliases, not part of Aura's published
   surface).

7. **The real types are strictly narrower than the shim they replaced
   (W396).** The deleted `src/theme/aura-react.d.ts` typed every wrapper as a
   generic `AuraComponent` with `variant?: string` and a catch-all
   `[attr: string]: unknown` — any prop name, any `variant` string, and any
   `events` key type-checked. The real generated types are closed: `variant` (and
   `elevation`, etc.) are the element's exact literal-string union, `events`
   is a per-element **closed** map of only the CustomEvents that element
   actually dispatches (a typo like `"aura:chnge"` is now a compile error,
   not a silent no-op listener), and there is no catch-all index signature
   beyond the `data-*`/`aria-*` template-literal keys — an unrecognized prop
   is now a real excess-property error instead of silently passing through.
   None of this broke anything in the existing codebase (finding 1), but it
   is a meaningfully stricter contract for whatever's written against Aura
   next: a consumer that needs to listen for a genuinely future/custom event
   must widen explicitly via the exported `AuraEventHandlers` escape hatch
   (`events={{ ...handlers } as AuraEventHandlers}`) rather than relying on an
   implicit catch-all.

Findings 2–5 and 7 remain live ecosystem signal for future Aura-in-React work;
finding 1 (the asset/types gap, #858) and finding 6 (the type-wiring
uncertainty) are resolved and kept here as historical record.

---

## 8. Cross-links

- Master contract / both seams: [../architecture-design.md §5.2](../architecture-design.md)
- Screen inventory (consumer of this language): [../harmony-ux-design.md](../harmony-ux-design.md)
- Native vibrancy seam (D2): `native-vibrancy-design.md`
- Dependency Channel reconciliation (W19): [../dependency-channel-conformance.md](../dependency-channel-conformance.md)
- Upstream Aura gap: design-language#858

## Open questions

- ~~Final pinned SHA on the `v3.20` channel~~ — **resolved by W2**:
  `83c50b3fa0014433abd0ce783ae5911b8a29f1d4` (written here + in front-matter).
- Whether a light `theme-harmony-dusk` ships in v0.1 or defers to a later release.
- Whether W19 mirrors the submodule into `vendor.toml` or keeps the submodule as
  the source of truth (reconciliation owned by W19).
