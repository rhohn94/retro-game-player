# CRT filter — authentic retro presentation, both play paths

> **Up:** [↑ Design docs](README.md) · **Sib:** [native-emulation-design.md](native-emulation-design.md), [in-page-play-design.md](in-page-play-design.md)

> **Status:** design-first (blocks implementation). Owns v0.29 **W280**.

## Motivation

User directive (2026-07-03, verbatim): *"Feature: state-of-the-art CRT
filter. Include scanlines, screen curvature, color bleed, etc. Make it
highly configurable."* Tracked as
[#23](https://github.com/rhohn94/harmony/issues/23).

## Ground truth: the two play paths render differently (resolved by research)

- **Native path** (`NativePlayer.tsx`): plain **Canvas2D**, `putImageData`
  paints each polled RGBA frame — no WebGL, no wgpu, no native window layer
  (`native-emulation-design.md` §3). Presentation is 100% frontend; a shader
  pass here requires **zero Rust changes**.
- **EJS path** (`InPagePlayer.tsx`): a genuine **cross-origin iframe**
  (`tauri://localhost` parent, `http://127.0.0.1:<port>` child,
  `in-page-play-design.md` §2). EmulatorJS owns its own WebGL2 canvas
  **inside** the iframe document. The parent can style the iframe element
  (CSS filters, overlay divs) but cannot reach inside for a true per-pixel
  shader without patching the vendored `player.html` runtime.

**Decision:** v1 accepts an intentional quality asymmetry rather than
blocking the release on an EmulatorJS-runtime patch:

| | Native path | EJS path |
|---|---|---|
| Scanlines | shader-drawn, per-scanline attenuation | CSS `repeating-linear-gradient` overlay div |
| Curvature | shader UV barrel-warp | CSS perspective/border-radius illusion on the iframe wrapper |
| Color bleed | shader RGB channel offset/blur | CSS `filter: blur()` + `saturate()` approximation |
| Mechanism | WebGL2 canvas replacing the Canvas2D paint path | parent-side CSS only, iframe content untouched |

## Scope (v0.29)

**In scope:**
- Native path: swap `NativePlayer.tsx`'s Canvas2D `putImageData` paint for a
  WebGL2 canvas; upload each polled frame as a texture; single fragment
  shader combining scanlines + barrel curvature + channel-offset color bleed
  + vignette, each parameterized 0–100.
- EJS path: a CSS-only approximation layered on the existing iframe wrapper
  (overlay div + `filter`), same parameter model, honestly lower fidelity.
- One shared config shape (per-effect intensity + named presets: **Off,
  Classic CRT, Arcade Cabinet, Sharp**) persisted through the existing
  settings persistence layer, with a live-preview settings panel.
- Config applies identically regardless of which path is active for a given
  game; the panel does not expose path-specific controls.

**Out of scope (recorded follow-ups):**
- Patching the vendored EmulatorJS `player.html` to expose its internal
  canvas for a true per-pixel shader (would close the fidelity gap above).
- Per-game/per-core automatic presets.
- Any change to core determinism, save states, or netplay — this is a
  presentation-only layer downstream of already-decoded frames.

## Acceptance

- A settings panel exposes scanlines / curvature / color-bleed sliders plus
  the four named presets, with a live preview.
- Native-path gameplay renders through the new WebGL2 pipeline with no
  regression to `native-perf.log` FPS beyond a documented, small shader-cost
  budget (agent picks a number and justifies it, e.g. "<10% avg frame time").
- EJS-path gameplay shows the CSS approximation with the same slider values
  producing a visibly consistent (not identical) look.
- `prefers-reduced-motion`: the filter itself introduces no motion (static
  per-frame effect); only a preset-change crossfade, if added, must ride the
  existing central motion tokens.
- All gates + `recipe.py smoke` green; this doc and `tv-mode-design.md` (if
  the filter renders in TV takeover) updated with any TV-specific notes.
