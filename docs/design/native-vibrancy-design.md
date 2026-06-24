# Native-Vibrancy Seam — Harmony v0.1 (D2)

> **Up:** [↑ Design docs](README.md) · [↑ Architecture master contract](architecture-design.md)

> **Status:** detailed spec for the native-vibrancy seam cross-linked from
> [architecture-design.md §5.1](architecture-design.md#51-native-vibrancy-seam--detailed-in-d2).
> Where this doc and the master contract disagree on a command name, return
> shape, or path, the **master contract wins** — this doc is the implementation
> detail beneath it. Implemented by **W1** (window config), **W10** (Rust
> pre-blur backend), and **W13** (hero render).

## Motivation

Harmony should feel like a first-class Mac app: a translucent window where the
desktop and the selected game's cover art bleed through a frosted-glass shell.
macOS provides this natively via `NSVisualEffectView`. The challenge is that
this is a **native ↔ web seam**: the native blur lives *below* the WKWebView,
the React/Aura UI paints *on top*, and the one effect we actually want for the
hero — a blurred enlargement of the selected cover art — is **in-app content**
that native vibrancy fundamentally cannot blur. This doc fixes the seam so the
three work items implementing it never guess at a config key, a CSS rule, an
invoke signature, or a cache path.

## Scope

**Covered:** the exact `tauri.conf.json` window/vibrancy keys and their
semantics; the transparent-webview CSS contract; the prohibition on CSS
`backdrop-filter`; the Rust pre-blurred-hero pipeline and its `get_blurred_hero`
handoff (the seam); traffic-light + drag-region handling; and the
distribution / entitlements consequences of `macOSPrivateApi: true`.

**Not covered (delegated):** the cover-art *fetch* and art-cache tiers
([metadata-art-design.md](metadata-art-design.md), W8); the `HeroBackdrop`
component's Framer Motion choreography internals
([harmony-ux-design.md](harmony-ux-design.md) / W13); Aura theming knobs
([ux/design-language.md](ux/design-language.md), D3). The `BlurredHero` DTO and
the `get_blurred_hero` command surface are **owned by the master contract**
([§2.6](architecture-design.md#26-vibrancy-blur-w10--seam-d2)) — reproduced here
for convenience, not redefined.

---

## 1. `tauri.conf.json` window config (the exact keys)

W1 writes this block. It is the only place window/vibrancy keys live; no other
item edits it.

```jsonc
"app": {
  "macOSPrivateApi": true,
  "windows": [
    {
      "transparent": true,
      "titleBarStyle": "Overlay",
      "hiddenTitle": true,
      "windowEffects": {
        "effects": ["sidebar"],
        "state": "followsWindowActiveState",
        "radius": 12.0
      }
    }
  ]
}
```

### Key-by-key

| Key | Value | Meaning |
|---|---|---|
| `app.macOSPrivateApi` | `true` | Opts the app into Tauri's use of Apple **private** APIs needed for a transparent NSWindow + live `NSVisualEffectView` material. **Required** for `transparent: true` to actually let vibrancy through. Carries a hard distribution cost — see [§6](#6-distribution--entitlements-implications). |
| `windows[].transparent` | `true` | Makes the NSWindow background transparent so whatever sits *behind* the WKWebView (the visual-effect view) is visible. Without this the webview paints over the vibrancy and you see nothing. |
| `windows[].titleBarStyle` | `"Overlay"` | Hides the standard opaque title bar and lets the webview extend full-height under it, while **keeping** the native traffic-light controls floating on top. Gives the frameless, content-first look. (Tauri enum: `Visible` \| `Transparent` \| `Overlay`.) |
| `windows[].hiddenTitle` | `true` | Suppresses the window title text so the overlay title bar is visually empty — only the traffic lights remain. |
| `windows[].windowEffects.effects` | `["sidebar"]` | The `NSVisualEffectMaterial` to apply. `sidebar` = `NSVisualEffectMaterialSidebar` (see material discussion below). Tauri's `WindowEffectsConfig` accepts an array; we use exactly one. |
| `windows[].windowEffects.state` | `"followsWindowActiveState"` | The `NSVisualEffectState`. The material brightens/desaturates when the window is key and dims when it loses focus — the standard macOS behaviour, so Harmony matches Finder/Music. |
| `windows[].windowEffects.radius` | `12.0` | Corner radius (pts) applied to the effect view so the frosted material follows the window's rounded corners cleanly instead of squaring them off. |

### Why `sidebar` (NSVisualEffectMaterial choice)

`NSVisualEffectView` exposes many semantic materials; three are plausible for a
full-window shell:

- **`sidebar`** (`NSVisualEffectMaterialSidebar`) — the material Finder/Mail/Music
  use for their source list. Medium translucency, desktop-tinted, legible over
  arbitrary wallpapers. **Chosen** — it reads as a calm, neutral frosted glass
  across the whole window and is the canonical "Mac app chrome" look.
- **`hudWindow`** (`NSVisualEffectMaterialHUDWindow`) — darker, heavier, designed
  for transient HUD palettes (think the volume OSD). Too dark and too "overlay-y"
  for a primary, persistent window; rejected.
- **`underWindowBackground`** (`NSVisualEffectMaterialUnderWindowBackground`) —
  intended for the area *under* a window's content, very subtle. Too faint to
  carry the whole shell; the desktop bleed-through is barely perceptible. Rejected.

`sidebar` gives the strongest balance of "native frosted glass" and content
legibility for a full-bleed window background.

### Why Tauri's built-in `windowEffects` over the `window-vibrancy` crate

Tauri 2.0 ships `WindowEffectsConfig` declaratively in `tauri.conf.json` and via
the `WebviewWindowBuilder::effects` API. **Prefer it** over the standalone
[`window-vibrancy`](https://crates.io/crates/window-vibrancy) crate: it is
maintained in-tree, requires no extra dependency or `setup`-hook glue, applies
before first paint (no flash of opaque window), and keeps the vibrancy config in
the same file as the rest of the window config. The `window-vibrancy` crate is
only warranted if we needed a material or per-runtime tweak the built-in config
cannot express — we do not for v0.1.

---

## 2. Transparent webview CSS contract

For native vibrancy to show through, the **web layer must paint on a transparent
background**. This is the non-negotiable foundation; D3/W2's Aura theming builds
on top of it.

```css
/* Owned by the theme layer (D3/W2); stated here as the seam contract. */
html,
body,
#root {
  background: transparent !important;
}
```

`!important` is intentional and load-bearing: it defends against any reset,
Aura base style, or component default that would otherwise set an opaque
`background` on these roots and occlude the vibrancy. These three selectors are
the **only** place transparency is mandated at the root; everything else opts
*in* to opacity deliberately.

### How Aura surfaces opt into translucency

The shell is transparent; **content sits on translucent Aura panels above it**.
Aura surfaces (cards, the detail rail, the top bar, dialogs) set a
**semi-transparent panel background** using an OKLCH colour with an alpha
channel, e.g.:

```css
/* Illustrative — concrete tokens live in theme/tokens.ts + Aura (D3). */
.aura-surface {
  background: oklch(0.22 0.02 265 / 0.62); /* dark neutral, 62% opaque */
}
```

This layering yields the desired look: the desktop/wallpaper and the blurred
hero ([§4](#4-rust-pre-blurred-hero-handoff-flow-the-seam)) read faintly through
every panel, while the panel's own translucent fill provides enough contrast for
text and controls to stay legible. Rules of thumb for the surface alpha:

- **Background-most layers** (the app shell gutter) → lowest opacity, maximal
  bleed-through.
- **Content panels** (game grid cards, the detail rail) → mid opacity (~0.55–0.70)
  so text contrast (WCAG AA) holds over a busy hero.
- **Text and primary controls** → fully opaque foreground tokens; never rely on a
  translucent layer for the text colour itself.

Legibility is verified against the *worst-case* background (a bright, busy hero),
not the empty desktop. Tune the alpha to that case in D3/W13.

---

## 3. The no-`backdrop-filter` rule (critical)

> **PROHIBITION.** Do **not** use CSS `backdrop-filter: blur(...)` (or
> `-webkit-backdrop-filter`) anywhere in Harmony. It is **unreliable / broken**
> in a transparent WKWebView under Tauri.

When a Tauri window is `transparent: true` on macOS, the WKWebView is composited
without an opaque backing surface. `backdrop-filter` needs to sample the pixels
*behind* the element to blur them; in a transparent webview those pixels are the
native vibrancy / desktop *outside* the web compositor, which WKWebView cannot
sample. The result is no blur, a flat grey, or flicker/glitching depending on
the macOS version — see Tauri issue
[#12804](https://github.com/tauri-apps/tauri/issues/12804). It cannot be relied
on, so we forbid it outright.

**Consequences for the design:**

- The *window-level* frost we want is provided by the native `NSVisualEffectView`
  ([§1](#1-tauriconfjson-window-config-the-exact-keys)), **not** CSS.
- The *blurred cover-art hero* we want cannot be produced by blurring an in-app
  `<img>` with CSS. It must be **pre-blurred in Rust** and handed to the web layer
  as an already-blurred bitmap — see [§4](#4-rust-pre-blurred-hero-handoff-flow-the-seam).

Any PR introducing `backdrop-filter` should be rejected in review.

---

## 4. Rust pre-blurred-hero handoff flow (the seam)

### Why Rust, not the GPU/CSS

`NSVisualEffectView` blurs **what is behind the window** (the desktop, other
windows) — it has no access to in-app content and cannot blur the selected
game's cover art. CSS `backdrop-filter` is forbidden ([§3](#3-the-no-backdrop-filter-rule-critical)).
So the blurred-cover-art backdrop is produced **server-side in Rust** and shipped
to React as a finished bitmap. The web layer only *composites* it — it never blurs.

### Pipeline (W10 — `core/vibrancy/`)

Input is the game's already-fetched cover art (`games.art_path` / `art_cache`,
owned by W8). The pipeline, run **off the UI thread** (Tokio blocking task):

1. **Load** the source art with the [`image`](https://crates.io/crates/image)
   crate.
2. **Downscale** to a small working size (target ~**96 px** on the longest edge).
   Blurring a tiny image is cheap and, when scaled back up by the browser as a
   full-bleed background, reads as a soft, heavy blur — the look we want, for a
   fraction of the cost of blurring at full resolution.
3. **Gaussian blur** the downscaled image (`image`'s `blur` / `imageops::blur`).
4. **Encode** to PNG (lossless, alpha-capable; matches `blur-cache/<…>.png` in the
   master contract's app-support layout).
5. **Cache** the encoded bytes to disk under
   `~/Library/Application Support/com.harmony.app/blur-cache/` keyed by game
   (see cache key below). Path resolution goes through `config/paths.rs` (W4) —
   never hard-code the app-support root.
6. **Return** a `BlurredHero` ([§4.3](#43-blurredhero-return-shape)) to the
   caller via `get_blurred_hero`.

### 4.1 Function signature & command (from the master contract — do not redefine)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `get_blurred_hero` | `{ gameId: number }` | `BlurredHero` | `async fn get_blurred_hero(game_id: i64) -> AppResult<BlurredHero>` |

The command adapter lives in `commands/vibrancy.rs` (registered through the
append-only macro in `commands/mod.rs`); the pure pipeline lives in
`core/vibrancy/` and is unit-tested independently of Tauri types. The TS wrapper
is `src/ipc/vibrancy.ts` (`get_blurred_hero`), re-exported from
`src/ipc/commands.ts`.

Errors map onto the unified `AppError`
([architecture §2](architecture-design.md#2-tauri-invoke-command-surface)):
- absent game / no art on disk → `AppError::NotFound`
- read/encode/cache-write failure → `AppError::Io`
- decode of a corrupt source image → `AppError::Internal`

### 4.2 Cache key & cache-hit behaviour

The on-disk file is keyed by **game** so heroes are reused across selections and
sessions. The master contract's app-support layout fixes the file as
`blur-cache/<game_id>.png` (keyed by `games.id`).

> **Cross-link note.** The architecture doc's §2.6 prose mentions a `<game-key>`
> and the layout shows `blur-cache/<game_id>.png`. Harmony v0.1 uses the
> **`games.id`** (the stable integer PK) as the cache key, materialised as the
> filename stem `<game_id>.png`. This is the concrete reading of the master
> contract's "per-game cache"; if a content-hash key is later wanted, revisit in
> the master doc's open question on indexing blurred art.

**Cache-hit:** on each call the pipeline first stats
`blur-cache/<game_id>.png`. If present (and non-empty), it is returned **without
re-blurring** — the expensive image work happens only on the **first** call per
game. The cache is invalidated implicitly: removing a game cascades its rows
(FKs, §3 of the master contract); a stale blur for a changed cover can be cleared
by deleting the file (W8 art refresh may remove it). For v0.1, presence ⇒ hit.

### 4.3 `BlurredHero` return shape (from the master contract)

```ts
// src/ipc/vibrancy.ts — mirrors the master contract §2 DTO; do not redefine.
export interface BlurredHero {
  dataUri: string | null;  // data: URI of the blurred PNG (inline render path)
  cachePath: string;       // absolute path under blur-cache/ (file render path)
  width: number;           // blurred bitmap width (px)
  height: number;          // blurred bitmap height (px)
}
```

W10 populates both `dataUri` (a `data:image/png;base64,…` of the small blurred
bitmap — small enough to inline) and `cachePath` (the on-disk file, served via
Tauri's asset/`convertFileSrc` protocol if W13 prefers a URL over an inline URI).
W13 chooses which to bind. `width`/`height` are the **blurred bitmap's**
dimensions (post-downscale, ~96 px longest edge), letting the layer set an
aspect-correct background.

### 4.4 React render (W13 — `components/HeroBackdrop.tsx`)

`HeroBackdrop` is mounted by `App.tsx` beneath the router (master contract §1.1).
On game selection it calls `get_blurred_hero({ gameId })`, then renders the
result as a **full-bleed background layer** — e.g. a fixed, full-window element
whose `background-image` is the `dataUri` (or `convertFileSrc(cachePath)`).
A **Framer Motion crossfade** animates the opacity between the outgoing and
incoming hero on each selection.

> **Hard rule restated for the render layer:** the hero image is **already
> blurred**. `HeroBackdrop` applies **no `filter`/`backdrop-filter: blur()`** —
> only positioning, sizing (`background-size: cover`), and the opacity crossfade.

---

## 5. Traffic-light + drag-region handling

With `titleBarStyle: "Overlay"` + `hiddenTitle: true`, the window is frameless
except for the native **traffic-light** controls (close/minimise/zoom) floating
in the top-left. Two things must be handled by the React shell (W13/W14 top bar):

### Dragging the window

A frameless window has no native title bar to grab, so the web layer must provide
a **drag region**. Tauri honours the `data-tauri-drag-region` attribute: any
element carrying it acts as a draggable title-bar surface.

- The Aura **top bar** carries a top drag strip via `data-tauri-drag-region` on
  its root (or a dedicated full-width strip element behind the bar's content).
- **Interactive children** (buttons, search field, menus) must *not* inherit the
  drag region, or clicks get swallowed by window-drag. Either omit the attribute
  on them or let interactive elements sit above the strip; in practice put
  `data-tauri-drag-region` on the strip background and keep controls as
  non-drag children.

### Traffic-light inset / not overlapping the controls

The traffic lights occupy roughly the top-left **~78×28 pt**. The Aura top bar
must **inset its left content** so its first control does not collide with them:

- Reserve a left padding of about **72–80 px** in the top bar before the first
  interactive element (back button, breadcrumb, etc.).
- Optionally, set a custom **`traffic_light_position`** (via the
  `WebviewWindowBuilder` / `set_traffic_light_position` at runtime in `lib.rs`
  setup) to nudge the controls' vertical centre to line up with the top bar's
  content baseline — useful if the top bar is taller than the default title-bar
  height. This is an **optional** polish for W1/W13; the mandatory part is the
  left inset so nothing renders under the controls.

The drag strip itself should span the full top edge **including** the area behind
the (non-draggable) traffic lights — macOS handles the controls; the rest of the
strip drags the window.

---

## 6. Distribution / entitlements implications

`macOSPrivateApi: true` is the load-bearing constraint here, and it does not
travel alone. Combined with Harmony's other native behaviours it **rules out the
Mac App Store**:

- **`macOSPrivateApi: true`** uses Apple **private** APIs → **rejected** by App
  Store review.
- **External dylib loading** — Harmony loads libretro core `.dylib`s
  (`cores/<system>/…_libretro.dylib`) at runtime, which the hardened runtime's
  default library validation forbids.
- **Shelling out to RetroArch** — Harmony launches an external RetroArch process,
  another App-Store-incompatible pattern.

**Conclusion: Harmony ships as a notarized, Developer-ID-signed DMG, not via the
Mac App Store.** The build must be code-signed with a Developer ID Application
certificate, **notarized** by Apple, stapled, and distributed as a DMG.

### Entitlements required

| Entitlement | Why |
|---|---|
| `com.apple.security.cs.disable-library-validation` | Allow loading the unsigned/third-party libretro core dylibs at runtime (the hardened runtime would otherwise refuse them). |
| `com.apple.security.device.bluetooth` | Bluetooth game controllers (8BitDo, DualSense, etc.). |
| `com.apple.security.device.usb` | USB-attached game controllers / adapters. |

These go in the macOS entitlements plist referenced from the Tauri bundle config.
Notarization with the hardened runtime **plus** `disable-library-validation` is
the supported path; it is mutually exclusive with App Store distribution, which
is the accepted trade-off for a libretro/RetroArch front-end.

---

## 7. Cross-links

- Master contract: [architecture-design.md](architecture-design.md) — §2.6
  (`get_blurred_hero` / `BlurredHero`), §4.1 (`blur-cache/`), §5.1 (this seam).
- Cover-art fetch + art cache (pipeline input): [metadata-art-design.md](metadata-art-design.md) (W8).
- Hero render + Framer Motion choreography: [harmony-ux-design.md](harmony-ux-design.md) (W13).
- Aura theming / OKLCH knobs / anti-FOUC: [ux/design-language.md](ux/design-language.md) (D3).
- Path resolution: [app-infrastructure-design.md](app-infrastructure-design.md) (W4).

## Open questions

- Whether to invalidate `blur-cache/<game_id>.png` on a W8 art **refresh**
  (re-fetch of better-tier art) rather than relying on manual deletion — likely a
  small hook in W8's art writer. Defer to W10/W8 integration.
- Whether `get_blurred_hero` should accept an optional target longest-edge size
  so W13 can request a sharper hero on Retina without a second pipeline. Out of
  scope for v0.1's fixed ~96 px.
