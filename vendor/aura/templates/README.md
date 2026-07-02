# Aura Blueprint Templates

Token-driven, framework-neutral page-layout blueprints for Aura. Blueprints
sit one level above the primitive components (`aura-shell`, `aura-region`,
`aura-field` …) and provide opinionated, production-ready page chrome — app
shells, form pages, and data-listing pages — all expressed in plain CSS that
composes with Aura tokens and components without locking you into any JS
framework.

Each blueprint is:

- **Token-driven** — every size, colour, blur, and spacing value reads from
  `var(--aura-*)` tokens. Override one token to restyle the whole page.
- **Zero-specificity tunables** — per-blueprint `--aura-<bp>-*` custom
  properties are set on `:where(:root)` so any selector overrides them.
- **Framework-neutral** — plain HTML + CSS; works with HTMX, React, or no JS
  at all.
- **BEM-scoped** — every selector is `.aura-<blueprint>` or
  `.aura-<blueprint>__<element>`. No global resets, no bleed.

---

## Consumption

### A — Submodule (recommended)

Link `css/aura.css`. The blueprint layers are already included via the
`@import` declarations in that file, so nothing else is needed:

```html
<link rel="stylesheet" href="vendor/aura/css/aura.css" />
```

Or, if you only want a single blueprint without the full Aura bundle, link the
foundation files (tokens + theme + base) plus the one blueprint sheet — but
**wrap them in an explicit `@layer aura`**. The cascade-layer assignment for
these files lives **only** in `css/aura.css`'s `@import … layer(…)` declarations;
the files themselves (`css/tokens.css`, `css/theme.css`, `css/base.css`,
`templates/app-shell.css`) carry **no `@layer` rule of their own**. Linked raw
with a plain `<link>`, they land **unlayered** — and unlayered styles win over
**every** `@layer`, so Aura would then sit at the highest cascade tier and the
"consumer CSS without `@layer` always overrides Aura" promise would no longer
hold (your overrides would have to out-specify Aura instead of simply being
unlayered).

To keep Aura layered — and your own unlayered CSS winning — pull the files in
through an `@layer aura` block from a tiny entry stylesheet:

```css
/* my-aura.css — link THIS one stylesheet instead of the raw files */
@layer aura {
  @import "vendor/aura/css/tokens.css";
  @import "vendor/aura/css/theme.css";
  @import "vendor/aura/css/base.css";
  @import "vendor/aura/templates/app-shell.css";
}
```

Then `<link>` that single `my-aura.css` entry stylesheet from your page.

If you instead `<link>` the four files raw, accept that Aura is **unlayered**:
your overrides then need higher specificity (or their own later-declared layer)
to win — order alone will not settle it, because both sides are unlayered. When
in doubt, link `css/aura.css` (option A above), which already carries the layer
assignment for the whole bundle.

### B — `dist/` bundle

The `dist/aura.css` build concatenates all layers including the blueprints.
Point at the dist file the same way:

```html
<link rel="stylesheet" href="vendor/aura/dist/aura.css" />
```

### C — Copy a recipe

Copy the markup recipe below for your chosen blueprint into your project.
Swap the hardcoded content for your own. Remove any `aura-*` primitives you
do not need. The blueprint CSS must still be on the page (via one of the
options above).

---

## Anti-FOUC theme bootstrap

Place this inline `<script>` as the **first child of `<head>`**, before any
stylesheet. It reads the user's saved preference from `localStorage` and sets
`data-aura-theme` on `<html>` before the first paint, eliminating the
dark→light flash.

```html
<head>
  <script>
    (function () {
      try {
        var saved = JSON.parse(localStorage.getItem("aura-theme") || "null");
        if (saved && saved.mode) {
          document.documentElement.setAttribute("data-aura-theme", saved.mode);
        } else {
          /* Default: dark. Change to "light" or "auto" to suit your app. */
          document.documentElement.setAttribute("data-aura-theme", "dark");
        }
      } catch (e) { /* storage blocked — fall through to CSS default */ }
    })();
  </script>
  <!-- stylesheets follow … -->
</head>
```

The persistence key is `"aura-theme"` (the default used by `Aura.theme.persist()`).
The stored object shape is `{ mode: "dark"|"light"|"auto", theme: "<name>" }`.

To wire up the toggle component once `js/theme.js` and `js/aura-theme-toggle.js`
are loaded, add the element anywhere in your markup:

```html
<!-- Cycles dark → light → auto on click. Reflects the current mode. -->
<aura-theme-toggle></aura-theme-toggle>
```

`<aura-theme-toggle>` **enables persistence automatically** on first connect
(`Aura.theme.persist(true, { key: "aura-theme" })`), so the chosen mode survives
reloads and the bootstrap above can restore it — no extra wiring needed. Add a
`no-persist` attribute to opt out, or call `Aura.theme.persist()` yourself for a
custom key:

```html
<aura-theme-toggle no-persist></aura-theme-toggle>
```

### Named-theme switcher — `<aura-theme-select>`

The dark/light **mode** axis is the toggle's job; the **named theme** (the look,
e.g. *Retro PC* or *Warm Dusk*) is `<aura-theme-select>`'s. It is the declarative
sibling of the toggle: load `js/theme.js`, `js/select.js`, and
`js/aura-theme-select.js`, drop the element in, and it self-wires with **zero
script** — on connect it registers the shipped named themes, builds one option
per theme, seeds the control from the persisted value, applies the chosen theme
on change, and persists it:

```html
<!-- Full, self-contained named-theme switcher — no consumer JS. -->
<aura-theme-select label="Theme"></aura-theme-select>
```

It applies the theme to the page's `<aura-app>` by default and persists under the
`"aura-demo-theme-name"` localStorage key. Two attributes tune it:

| Attribute | Effect |
|---|---|
| `scope="<selector>"` | Apply to a specific subtree instead of `<aura-app>` (e.g. `scope="#preview"` for a scoped live preview). |
| `no-persist` | Do not read or write localStorage — for a preview that must not clobber the page-wide choice. |

```html
<!-- A scoped, non-persisting preview switcher driving only #preview. -->
<aura-theme-select scope="#preview" no-persist></aura-theme-select>
```

Pair it with `<aura-theme-toggle>` for a complete, script-free theme panel
(exactly what every Aura demo's footer panel ships).

---

## Blueprint recipes

### 1. App Shell — `.aura-app-shell`

Full-viewport application chrome: sticky glass header, collapsible sidebar,
scrolling main area, footer strip.

**Canonical selectors:** `.aura-app-shell`, `__header`, `__sidebar`,
`__nav-toggle`, `__main`, `__footer`

**Tunables:**

| Property | Default | Effect |
|---|---|---|
| `--aura-app-shell-sidebar-size` | `16rem` | Expanded sidebar width |
| `--aura-app-shell-header-blur` | `18px` | Header glass blur intensity |

```html
<html lang="en" data-aura-theme="dark">
<head>
  <script>/* anti-FOUC snippet above */</script>
  <link rel="stylesheet" href="vendor/aura/css/aura.css" />
</head>
<body>
<aura-app theme="dark">
  <div class="aura-app-shell">

    <!-- Glass header -->
    <header class="aura-app-shell__header aura-sheen">
      <!-- Nav toggle: lives in the header, shown only when the sidebar is
           collapsed (narrow viewports). data-aura-shell-toggle wires the click
           to shell-nav.js — no custom JS needed. -->
      <button class="aura-app-shell__nav-toggle" data-aura-shell-toggle
              aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">
        <!-- hamburger icon -->
      </button>
      <div><!-- brand / logo --></div>
      <nav><!-- top-level navigation links --></nav>
      <div>
        <!-- Mode toggle; requires js/aura-theme-toggle.js -->
        <aura-theme-toggle></aura-theme-toggle>
        <!-- Additional header actions -->
        <aura-button variant="primary" icon="check">Save</aura-button>
      </div>
    </header>

    <!-- Sidebar: hidden on narrow viewports; slides in as a drawer when the
         toggle is pressed. data-aura-sidebar marks it as the drawer
         js/shell-nav.js drives. -->
    <nav class="aura-app-shell__sidebar" id="sidebar" data-aura-sidebar
         aria-label="Site navigation">
      <!-- aura-region makes only the nav content scroll, not the whole sidebar -->
      <aura-region>
        <!-- nav items … -->
      </aura-region>
    </nav>

    <!-- Main content region -->
    <main class="aura-app-shell__main">
      <aura-region>
        <!-- page content -->
      </aura-region>
    </main>

    <!-- Footer -->
    <footer class="aura-app-shell__footer aura-sheen">
      <!-- footer content -->
    </footer>

  </div>
</aura-app>
</body>
</html>
```

---

### 2. Form Page — `.aura-form-page`

Centred, card-contained layout for authentication, settings, and
single-task data-entry screens.

**Canonical selectors:** `.aura-form-page`, `__card`, `__head`, `__error`,
`__actions`

**Tunables:**

| Property | Default | Effect |
|---|---|---|
| `--aura-form-page-card-size` | `26rem` | Maximum card inline width |

```html
<aura-app theme="dark">
  <aura-shell>
    <aura-region>

      <main class="aura-form-page">
        <aura-card class="aura-form-page__card" elevation="3">

          <!-- Heading area -->
          <div class="aura-form-page__head">
            <h1>Sign in</h1>
            <p class="aura-muted">Welcome back — enter your credentials.</p>
          </div>

          <!-- Inline error banner (show/hide via JS or server-render) -->
          <div class="aura-form-page__error" role="alert" hidden>
            <!-- error message text -->
          </div>

          <!-- Fields use aura-field for label + hint + error wiring -->
          <aura-field label="Email">
            <input type="email" name="email" autocomplete="email" required />
          </aura-field>

          <aura-field label="Password">
            <input type="password" name="password" autocomplete="current-password" required />
          </aura-field>

          <!-- Actions row -->
          <div class="aura-form-page__actions">
            <a href="/forgot">Forgot password?</a>
            <aura-button variant="primary" type="submit">Sign in</aura-button>
          </div>

        </aura-card>
      </main>

    </aura-region>
  </aura-shell>
</aura-app>
```

---

### 3. List Page — `.aura-list-page`

Data-listing page with KPI summary strip, filterable card grid or table,
empty state, and pagination bar.

**Canonical selectors:** `.aura-list-page`, `__head`, `__grid`, `__empty`,
`__pager`; plus standalone sub-components `.aura-data-table`, `.aura-stat-grid`

**Tunables:**

| Property | Default | Effect |
|---|---|---|
| `--aura-list-page-min-col` | `16rem` | Min column width for grid and stat grid |

```html
<aura-app theme="dark">
  <aura-shell>
    <aura-region>

      <main class="aura-list-page">

        <!-- Page header + actions -->
        <div class="aura-list-page__head">
          <h1>Users</h1>
          <aura-row gap="2">
            <aura-button variant="ghost" icon="filter">Filter</aura-button>
            <aura-button variant="primary" icon="plus">New user</aura-button>
          </aura-row>
        </div>

        <!-- Optional KPI strip (standalone — use anywhere) -->
        <div class="aura-stat-grid">
          <aura-card elevation="1">
            <span class="aura-muted">Total users</span>
            <strong>1,284</strong>
          </aura-card>
          <aura-card elevation="1">
            <span class="aura-muted">Active today</span>
            <strong>342</strong>
          </aura-card>
          <aura-card elevation="1">
            <span class="aura-muted">New this week</span>
            <strong>28</strong>
          </aura-card>
        </div>

        <!-- Card grid (auto-fills columns; each card is one list item) -->
        <div class="aura-list-page__grid">
          <aura-card elevation="1"><!-- item --></aura-card>
          <aura-card elevation="1"><!-- item --></aura-card>
          <!-- … -->

          <!-- Empty state: render when grid has zero items -->
          <div class="aura-list-page__empty" hidden>
            <p>No users found. <a href="#">Create the first one.</a></p>
          </div>
        </div>

        <!-- Alternatively, use a data table instead of the card grid -->
        <table class="aura-data-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr>
          </thead>
          <tbody>
            <tr><td>Ada Lovelace</td><td>ada@example.com</td><td>Owner</td><td>2024-01-01</td></tr>
          </tbody>
        </table>

        <!-- Pagination bar -->
        <nav class="aura-list-page__pager" aria-label="Pagination">
          <aura-button variant="ghost" icon="chevron-left" aria-label="Previous page">Prev</aura-button>
          <!-- page indicators -->
          <aura-button variant="ghost" icon="chevron-right" aria-label="Next page">Next</aura-button>
        </nav>

      </main>

    </aura-region>
  </aura-shell>
</aura-app>
```

### 4. Content-page chrome — composable in-page patterns

Not a whole page like the three above — these are the reusable content-level
building blocks (brand lockup, page header, nav list, card grid, list / property
/ timeline rows, keyboard-hint strip, colour swatch) that pages and demos
compose. Use any one standalone; they carry no layout assumptions beyond their
own box. This is the layer the Aura demos themselves consume so a control shown
in a demo is always available downstream.

**Canonical selectors:** `.aura-brand` (`__mark`, `__title`); `.aura-page-head`
(`__eyebrow`, `__lead`); `.aura-nav-list` (`__section`, `__item` + `.is-active`,
`__dot`); `.aura-card-grid`; `.aura-list-row` (`__meta`, `__title`, `__sub` +
`.is-active`); `.aura-prop-row` (`__label`, `__value`); `.aura-timeline`
(`__item`, `__dot`, `__time`); `.aura-key-hint` (styles nested `<kbd>`);
`.aura-swatch`.

**Tunables:**

| Property | Default | Effect |
|---|---|---|
| `--aura-content-page-size` | `var(--aura-size-2xl)` | Max width of `.aura-content-page` |
| `--aura-content-page-min-col` | `14rem` | Min column width for `.aura-card-grid` |

```html
<!-- Brand lockup in an app-shell header -->
<header class="aura-app-shell__header">
  <span class="aura-brand">
    <span class="aura-brand__mark">A</span>
    <h1 class="aura-brand__title">Aura</h1>
  </span>
</header>

<!-- Sidebar navigation -->
<nav class="aura-nav-list">
  <span class="aura-nav-list__section">Workspace</span>
  <a class="aura-nav-list__item is-active" href="#"><i class="aura-nav-list__dot"></i> Dashboard</a>
  <a class="aura-nav-list__item" href="#">Reports</a>
</nav>

<!-- A content page: header + card grid -->
<main class="aura-content-page">
  <div class="aura-page-head">
    <span class="aura-page-head__eyebrow">Overview</span>
    <h2>Projects</h2>
    <p class="aura-page-head__lead">Everything your team is shipping this quarter.</p>
  </div>

  <div class="aura-card-grid">
    <aura-card elevation="1"><!-- item --></aura-card>
    <aura-card elevation="1"><!-- item --></aura-card>
  </div>

  <!-- Master/detail list rows -->
  <a class="aura-list-row is-active" href="#">
    <aura-card class="aura-brand__mark" elevation="1">AL</aura-card>
    <span class="aura-list-row__meta">
      <span class="aura-list-row__title">Ada Lovelace</span>
      <span class="aura-list-row__sub">ada@example.com</span>
    </span>
  </a>

  <!-- Property rows + activity timeline -->
  <div class="aura-prop-row"><span class="aura-prop-row__label">Status</span><span class="aura-prop-row__value">Active</span></div>
  <ul class="aura-timeline">
    <li class="aura-timeline__item"><i class="aura-timeline__dot"></i><span class="aura-timeline__time">2h ago</span> Deployed v2.5</li>
  </ul>

  <p class="aura-key-hint">Press <kbd>?</kbd> for shortcuts</p>
  <span class="aura-swatch" style="--aura-swatch-color: var(--aura-primary)">Primary</span>
</main>
```

---

## Page archetypes

Four whole-page archetypes built on the `content-page` substrate — they compose
its building blocks (`.aura-page-head`, `.aura-prop-row`, `.aura-timeline`,
`.aura-nav-list`, `.aura-list-row`) rather than redefining them, and add only
the page-level frame each archetype needs. Each lives on its own cascade layer
(`detail-page`, `settings-page`, `dashboard-page`, `error-page`), ordered after
`content-page` in `css/aura.css`.

### 5. Detail Page — `.aura-detail-page`

Record-detail layout: a hero (title + actions), a two-column body pairing the
primary content stream with a sticky metadata aside. Collapses to one column
below a `52rem` container width.

**Canonical selectors:** `.aura-detail-page`, `__hero`, `__actions`, `__body`,
`__main`, `__aside`, `__section`

**Tunables:**

| Property | Default | Effect |
|---|---|---|
| `--aura-detail-page-size` | `var(--aura-size-xl)` | Max width of the centred column |
| `--aura-detail-page-aside-size` | `18rem` | Metadata aside inline size |

The body's single-column collapse point is a fixed `52rem` `@container`
breakpoint, not a custom property: a container-query feature value cannot read a
`var()`, so it is a hardcoded literal in `templates/detail-page.css` and is not
consumer-overridable.

```html
<main class="aura-detail-page">
  <div class="aura-detail-page__hero">
    <div class="aura-page-head">
      <span class="aura-page-head__eyebrow">Invoice · INV-20482</span>
      <h1>Acme Robotics — March retainer</h1>
      <p class="aura-page-head__lead">Issued 4 March 2026 · Net 30</p>
    </div>
    <div class="aura-detail-page__actions">
      <aura-chip variant="success">Paid</aura-chip>
      <aura-button variant="primary" icon="send">Send copy</aura-button>
    </div>
  </div>

  <div class="aura-detail-page__body">
    <div class="aura-detail-page__main">
      <section class="aura-detail-page__section">
        <h2>Line items</h2>
        <div class="aura-prop-row">
          <span class="aura-prop-row__label">Engineering retainer</span>
          <span class="aura-prop-row__value">$24,000.00</span>
        </div>
        <!-- … -->
      </section>
    </div>

    <aside class="aura-detail-page__aside">
      <aura-card elevation="1">
        <div class="aura-prop-row">
          <span class="aura-prop-row__label">Status</span>
          <span class="aura-prop-row__value">Paid</span>
        </div>
      </aura-card>
    </aside>
  </div>
</main>
```

### 6. Settings Page — `.aura-settings-page`

Preferences layout: a settings nav rail (reusing `.aura-nav-list`) beside a
stack of grouped panels. Each `__row` pairs a label + description with a trailing
control. Stacks the rail above the content below a `48rem` container width.

**Canonical selectors:** `.aura-settings-page`, `__nav`, `__content`, `__group`,
`__group-head`, `__row`, `__label`, `__desc`

**Tunables:**

| Property | Default | Effect |
|---|---|---|
| `--aura-settings-page-size` | `var(--aura-size-xl)` | Max width of the layout |
| `--aura-settings-page-nav-size` | `14rem` | Nav rail inline size |

The rail's stack point is a fixed `48rem` `@container` breakpoint, not a custom
property: a container-query feature value cannot read a `var()`, so it is a
hardcoded literal in `templates/settings-page.css` and is not
consumer-overridable.

```html
<div class="aura-settings-page">
  <nav class="aura-settings-page__nav" aria-label="Settings sections">
    <!-- .aura-nav-list — use a <nav>/<div>, not a <ul>, so __section spans and
         __item anchors are valid direct children. -->
    <div class="aura-nav-list">
      <span class="aura-nav-list__section">Personal</span>
      <a class="aura-nav-list__item is-active" href="#profile">Profile</a>
    </div>
  </nav>

  <div class="aura-settings-page__content">
    <section class="aura-settings-page__group">
      <div class="aura-settings-page__group-head">
        <h2>Notifications</h2>
        <p>Choose what reaches your inbox.</p>
      </div>
      <div class="aura-settings-page__row">
        <div>
          <span class="aura-settings-page__label">Email digests</span>
          <span class="aura-settings-page__desc">A weekly activity summary.</span>
        </div>
        <aura-switch checked aria-label="Email digests"></aura-switch>
      </div>
    </section>
  </div>
</div>
```

### 7. Dashboard Page — `.aura-dashboard-page`

Overview layout: a header row, a KPI metric strip, and a responsive tile grid.
Tiles span via `.is-wide` (two columns) / `.is-tall` (two rows); spans drop on
narrow viewports so nothing overflows one column.

**Canonical selectors:** `.aura-dashboard-page`, `__head`, `__metrics`,
`__metric` (`-label`, `-value`, `-trend` + `.is-up`/`.is-down`), `__grid`,
`__tile` (+ `.is-wide`/`.is-tall`), `__tile-head`

**Tunables:**

| Property | Default | Effect |
|---|---|---|
| `--aura-dashboard-page-size` | `var(--aura-size-2xl)` | Max width of the column |
| `--aura-dashboard-page-metric-col` | `12rem` | Min KPI cell width (auto-fill) |
| `--aura-dashboard-page-tile-col` | `20rem` | Min tile width (auto-fill) |

```html
<main class="aura-dashboard-page">
  <div class="aura-dashboard-page__head">
    <div class="aura-page-head"><h1>Revenue dashboard</h1></div>
    <aura-button variant="ghost" icon="calendar">Last 30 days</aura-button>
  </div>

  <div class="aura-dashboard-page__metrics">
    <div class="aura-dashboard-page__metric">
      <span class="aura-dashboard-page__metric-label">Revenue</span>
      <span class="aura-dashboard-page__metric-value">$48.2k</span>
      <span class="aura-dashboard-page__metric-trend is-up">▲ 12.4%</span>
    </div>
    <!-- … -->
  </div>

  <div class="aura-dashboard-page__grid">
    <section class="aura-dashboard-page__tile is-wide">
      <div class="aura-dashboard-page__tile-head"><h2>Revenue over time</h2></div>
      <!-- chart -->
    </section>
    <section class="aura-dashboard-page__tile is-tall">
      <div class="aura-dashboard-page__tile-head"><h2>Recent activity</h2></div>
      <ul class="aura-timeline"><!-- … --></ul>
    </section>
  </div>
</main>
```

### 8. Error Page — `.aura-error-page`

Status / empty-state layout for 404 / 403 / 500 / maintenance screens: a centred
column with an oversized gradient status code, headline, blurb, action row, and a
muted support footnote.

**Canonical selectors:** `.aura-error-page`, `__inner`, `__code`, `__title`,
`__lead`, `__actions`, `__support`

**Tunables:**

| Property | Default | Effect |
|---|---|---|
| `--aura-error-page-size` | `var(--aura-size-md)` | Max width of the content column |
| `--aura-error-page-code-size` | `var(--aura-text-3xl)` | Base size of the status code (scaled ×2.5) |

```html
<main class="aura-error-page">
  <div class="aura-error-page__inner">
    <p class="aura-error-page__code">404</p>
    <h1 class="aura-error-page__title">This page wandered off</h1>
    <p class="aura-error-page__lead">The page may have been moved or renamed.</p>
    <div class="aura-error-page__actions">
      <aura-button variant="primary" icon="home">Back to home</aura-button>
      <aura-button variant="ghost" icon="search">Search the site</aura-button>
    </div>
    <p class="aura-error-page__support">Reference <code>ERR-404-A1</code>.</p>
  </div>
</main>
```
