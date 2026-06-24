---
source: submodule
source-url: https://github.com/rhohn94/design-language
source-sha: "83c50b3fa0014433abd0ce783ae5911b8a29f1d4"  # W2 pinned (v3.20 channel)
source-pin: "v3.20"  # stable release channel; bare vX.Y.Z tags carry no assets
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

Vite aliases let app code import the React adapter from the submodule tree:

```ts
// vite.config.ts  (W2 establishes the alias)
resolve: {
  alias: {
    "@aura/react": fileURLToPath(new URL("./vendor/aura/bindings/react", import.meta.url)),
    "@aura/css":   fileURLToPath(new URL("./vendor/aura/css", import.meta.url)),
  },
}
```

```ts
// src/theme/AuraProvider.tsx  (D3/W2)
import "@aura/css/aura.css";              // the @layer barrel
import { AuraApp, AuraCard, AuraButton } from "@aura/react";
```

The `jsx.d.ts` from `vendor/aura/bindings/react` is added to `tsconfig`'s
`include`/`types` so `<aura-*>` elements type-check in TSX.

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

1. **`bindings/react` not in the release asset (design-language#858).** The
   single biggest gap: the v3.20 asset bundle omits the React adapter, so a clean
   package install yields custom elements with **no** typed wrappers, no hooks,
   and no `jsx.d.ts`. Resolution: the **submodule pin** (§2). Without it, React
   consumers must hand-write wrappers — exactly the duplication Aura's adapter
   exists to prevent.

2. **`events`/`class` vs `onChange`/`className`.** Aura custom elements emit DOM
   **CustomEvents** and key off the **`class`** attribute. React's synthetic
   `onChange` does **not** fire for them, and React reserves `className`. Code
   must use the typed wrappers (which bridge to `addEventListener` + `class`) — or
   `ref` + `addEventListener` by hand. Mixing React idioms onto raw `<aura-*>`
   silently no-ops. This is the most common foot-gun for UI agents; the
   `theme/` + `components/` wrappers exist to hide it.

3. **Controlled-input mismatch.** Because the change event isn't React's, the
   usual `value` + `onChange` controlled-component pattern doesn't apply directly
   to `<aura-field>`. The wrappers expose a React-idiomatic `value`/`onValueChange`
   surface and reconcile it to the element's property + CustomEvent internally.

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

6. **Type wiring.** The `jsx.d.ts` must be in `tsconfig` `include` for TSX to
   accept `<aura-*>` tags; this is easy to miss when consuming from a submodule
   path rather than `node_modules`.

These findings are also surfaced upstream where applicable (#858) and feed W19's
Dependency-Channel reconciliation.

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
