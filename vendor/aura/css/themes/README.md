# Aura themes

A **theme is only a named set of token values** — never component-specific CSS.
Each theme is one file here containing a single attribute-scoped rule:

```css
[data-aura-theme-name="modern-flat"] {
  --aura-depth: 0.7;
  --aura-radius-lg: 0.5rem;
  /* …any --aura-* tokens… */
}
```

## Using a theme (app-author choice)

Include only the theme files you ship. Two paths:

- **Pin one theme** (no switching): link the file and call once —
  `Aura.theme.pin("modern-flat")`. Authors who want a single fixed look stop
  here; the switcher is never exposed.
- **Offer switching**: link several theme files, build a control from
  `Aura.theme.listThemes()`, and wire it to `Aura.theme.setTheme(name)`.
  Optionally `Aura.theme.persist(true)` to remember the choice across reloads.

Switching is just flipping the `data-aura-theme-name` attribute on a scope
(`<html>`, an `aura-app`, or any subtree), so it composes with the dark/light
**mode** axis (`data-aura-theme`) and survives HTMX swaps — the cascade does
the work, no re-render.

## Authoring a theme

Two paths produce the same file shape:

- **By hand** — add `your-theme.css` here with the single
  `[data-aura-theme-name="…"]` rule.
- **In the editor** — edit tokens in `demo/theme-authoring.html`, name the
  theme, and hit **Export CSS** (`Aura.theme.downloadTheme`). The download is a
  drop-in `your-theme.css` for this directory. The editor is
  fidelity-preserving: derived tokens keep their `var()` link and perceptual
  colours stay in `oklch()`, so nothing is flattened to static hex on export.

Then:

1. `Aura.theme.registerTheme("your-theme", { label: "Your Theme" })` so it
   appears in switchers.
2. Keep it token-only. A theme that needs a component rule is a bug in the
   token surface — add the missing token instead.

`warm-dusk.css` is a curated theme authored through this export flow.

## Shipped themes

| File | Label | Character |
|---|---|---|
| `modern-flat.css` | Modern Flat | Calmer, flatter Aura — lighter depth, gentler glass, squarer corners. |
| `warm-dusk.css` | Warm Dusk | A warm, dusky palette authored through the export flow. |
| `flat-primary.css` | Flat Primary | A flat theme whose surfaces derive from the chosen primary/secondary — change the brand pair and the whole theme re-skins. |
| `extra-depth.css` | Extra Depth | Maximised layering — heavy shadows, strong bevels, rich glass; stacking of planes is unmistakable. |
| `retro-pc.css` | Retro PC | Windows 95/98 chrome (square corners, 3-D outset bevels, classic faces) crossed with vaporwave neon + a sunset-gradient desktop. |

The non-flat looks (Extra Depth, Retro PC) rely on the v2.10 frame/bevel token
group — see §10 — yet remain strictly token-only: no component CSS in any theme.

See `docs/design/theming-and-configuration-design.md` §7–10.
