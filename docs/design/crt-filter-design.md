# CRT filter — authentic retro presentation, both play paths

> **Up:** [↑ Design docs](README.md) · **Sib:** [native-emulation-design.md](native-emulation-design.md), [in-page-play-design.md](in-page-play-design.md)

> **Status:** design-first (blocks implementation). Owns v0.29 **W280**.

## Motivation

User directive (2026-07-03, verbatim): *"Feature: state-of-the-art CRT
filter. Include scanlines, screen curvature, color bleed, etc. Make it
highly configurable."* Tracked as
[#23](https://github.com/rhohn94/retro-game-player/issues/23).

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

## Implementation record (v0.29, W280)

Implemented as designed above; no deviation from the decided architecture.
Decisions made while implementing:

### Config shape

One `CrtFilterConfig` (Rust `src-tauri/src/config/mod.rs`, mirrored by the
frontend `src/ipc/crt-filter.ts`): four `u8` intensities in [0, 100]
(`scanlines`, `curvature`, `color_bleed`/`colorBleed`, `vignette`) plus an
`Option<CrtPreset>` recording the last-applied named preset (`None` once a
slider is dragged away from every preset's exact quadruple — recomputed from
the intensities by `matchingPreset()`, never trusted from a stale field).
Persisted in `AppConfig.crt_filter`, defaulting to the **Off** preset (an
opt-in presentation layer, not a surprise default — same posture as
`auto_tv_mode`). New IPC: `get_crt_filter` / `set_crt_filter`
(`commands/crt_filter.rs`), intensities clamped backend-side on write.

Preset intensities (mirrored exactly between `CrtPreset::intensities()` in
Rust and `CRT_PRESETS` in `src/features/play/crtFilter.ts` — kept in sync by
inspection since a numeric table has no natural single source of truth
across the FFI boundary):

| Preset | Scanlines | Curvature | Color bleed | Vignette |
|---|---|---|---|---|
| Off | 0 | 0 | 0 | 0 |
| Classic CRT | 55 | 25 | 35 | 30 |
| Arcade Cabinet | 70 | 55 | 45 | 55 |
| Sharp | 20 | 0 | 10 | 10 |

### Native path — WebGL2 pipeline

`src/features/play/crtWebglRenderer.ts`'s `CrtWebglRenderer` class owns the
GL context/program/texture/VAO lifecycle; `NativePlayer.tsx`'s paint step
constructs one lazily against the mounted `<canvas>` on the first polled
frame, uploads each subsequent frame via `texImage2D`, and draws a single
full-viewport triangle (no vertex buffer — positions derived from
`gl_VertexID`) through the combined fragment shader in
`src/features/play/crtShader.ts`. Effect order: barrel curvature (UV warp,
out-of-bounds pixels paint black rather than sampling garbage — reads as a
CRT bezel) → RGB channel-offset color bleed → cosine scanline attenuation
(pitch derived from `u_resolution` so it always matches the source
resolution, not the display size) → radial vignette. If WebGL2 context
creation or shader compile/link fails, the paint step falls back to the
pre-W280 plain `putImageData` for the rest of that mount (never a blank
screen — same "degrade, don't break" posture the EJS-fallback path already
uses elsewhere in this app); the failure isn't retried every frame.

**Shader-cost budget: <10% average frame-time increase, justified
analytically rather than by an on-device before/after trace** (no on-device
native-play session was available in this implementation environment — see
Follow-ups). Reasoning:

- NES frames are 256×240 = 61,440 pixels. At the native ~60.0988 Hz core
  rate that's ~3.7M fragment-shader invocations/second — trivial for any
  GPU capable of running a modern webview compositor at all (a phone GPU
  from several years ago clears this by 2–3 orders of magnitude).
- The shader does a fixed, small amount of work per pixel: one UV warp (a
  handful of ALU ops), three dependent texture samples (vs. one before),
  one cosine, and a few multiply-adds for the vignette — no loops, no
  branches on the hot path (the only branch is the curvature
  out-of-bounds check, which is a single comparison).
- Critically, **the shader cost is isolated to the browser/GPU compositor
  paint step and never touches the Rust core loop**: `NativeRuntime`'s
  `FrameClock`-paced tick (native-emulation-design.md §2) runs independently
  of how the frontend paints whatever frame it last produced — the
  raw-bytes poll (W239) already tolerates a slow/skipped paint by design
  (the in-flight guard degrades to a skipped frame, never a halved core
  tick rate). So even a pathologically slow shader could only ever cost
  *visual smoothness* (a dropped paint), never the *audio-critical* core
  timing `native-perf.log` actually measures — the FPS/underrun counters in
  that log are structurally insulated from this change. This is why "no
  regression to `native-perf.log` FPS" is expected to hold by construction,
  not just by measurement.
- The single most expensive addition over the old `putImageData` path is
  going from a CPU memcpy-ish blit to a GPU texture upload + a tiny fragment
  program — for a 245 KB (256×240×4) upload at 60 Hz this is well inside
  what `texImage2D` handles routinely (video/game engines upload far larger
  textures at 60+ Hz routinely).
- **Follow-up (recorded below):** replace this analytical justification with
  a real on-device `native-perf.log` before/after capture once a real
  fceumm session is available to profile (the perf log's existing FPS line,
  W274, is the natural before/after signal — this task didn't have to add
  new instrumentation for it).

### EJS path — CSS approximation

`src/features/play/CrtCssOverlay.tsx` wraps the iframe (unchanged, still
owned by `InPagePlayer.tsx`) in three layers, all driven by
`crtCssMapping.ts`'s pure `crtConfigToCssVars()` mapping the shared config
into CSS custom properties (`crt-overlay.css`, `rgp-theme` layer, tokens
only):

- **Curvature illusion** — a `perspective` context on the outer wrapper plus
  a `rotateX()` tilt + `border-radius` on the iframe's direct parent (a
  believable "looking at a CRT" tilt/bezel, not a true per-pixel barrel
  warp — the honest CSS-side approximation the design doc calls for).
- **Color bleed approximation** — `filter: blur() saturate()` on the same
  tilted wrapper (analog softness + a touch of phosphor-bloom saturation).
- **Scanlines** — a `repeating-linear-gradient` overlay `<div>`, absolutely
  positioned, `pointer-events: none`.
- **Vignette** — a `radial-gradient` overlay `<div>`, same positioning.

No change to the vendored `player.html` or any EmulatorJS internals — every
effect is parent-side CSS on the existing iframe wrapper, per the design
doc's explicit decision.

### One shared surface

`src/features/play/useCrtFilter.ts` is the single hook both play paths and
the settings panel read/write (load once, debounce slider persistence at
400 ms — mirrors `usePlayerPrefs`'s volume-slider pattern; preset selection
persists immediately, a discrete action rather than a drag). Settings →
**CRT Filter** (`src/features/settings/panes/CrtFilterPane.tsx`) exposes the
four sliders, the four preset buttons, and a live preview
(`CrtFilterPreview.tsx`) rendering a static color-bar test card
(`crtPreviewPattern.ts`) through **both real pipelines side by side** — the
actual `CrtWebglRenderer` on the left, the actual `CrtCssOverlay` on the
right — so a slider drag visibly updates both at once from the one shared
config, proving the "applies identically regardless of path" contract
rather than asserting it.

### Reduced motion

The filter is a static per-frame effect (no animation of its own). No
preset-change crossfade was added in v1 (an instant swap reads fine for a
settings-panel live preview); if a future pass adds one to the in-game
overlay, it must ride `src/theme/motion.css`'s `--rgp-dur-*`/`--rgp-ease-*`
tokens and the app-level `<MotionConfig reducedMotion="user">` convention
rather than a new per-component rule, per this doc's original acceptance
criterion.

### §measurement — real GPU draw-cost numbers (v0.38 W381, closes #35)

Replaces the analytical shader-cost budget above with a **real, on-device
measurement** of the actual draw call. `CrtWebglRenderer` (`crtWebglRenderer.ts`)
feature-detects `EXT_disjoint_timer_query_webgl2` once at construction:

- **When supported:** each `draw()` call is bracketed by a GPU timer query
  (`beginQuery`/`endQuery` around `drawArrays`). Timer queries never resolve
  synchronously, so the *previous* draw's query is polled non-blockingly
  (`getQueryParameter(..., QUERY_RESULT_AVAILABLE)`) at the start of the next
  `beginTimerQuery()` call, and again from the `lastDrawCostMs` getter. A
  resolved-but-`GPU_DISJOINT_EXT`-flagged result (the driver reporting the
  measurement window as unreliable, e.g. a GPU reset) is discarded rather than
  published — `lastDrawCostMs` only ever reflects a result the driver itself
  vouches for. At most one query is ever in flight; a draw whose predecessor
  hasn't resolved yet simply skips starting a new one rather than stacking
  queries.
- **When unsupported (the no-extension fallback):** `getExtension` returns
  `null`, `timerExt` stays `null`, and every timer-query code path becomes a
  no-op — no query objects are ever created, `beginQuery`/`endQuery` are never
  called, and `lastDrawCostMs` stays `null` for the renderer's whole lifetime.
  This is the expected, unremarkable outcome on any browser/driver combination
  that doesn't expose the extension (this is a real GPU/driver capability gap,
  not something the app can work around) — the shader's correctness and the
  `putImageData` fallback path are both completely unaffected either way.

**Where the numbers go.** The measurement has no counterpart inside
`native-perf.log` itself: that on-disk file is owned end-to-end by
`play::native::runtime` (this release's separate W380 frame-path item, whose
own truncate-per-session `PerfLogFile` sink has no visibility into the
frontend's WebGL draw calls), and the IPC *frame* contract between the two
halves is frozen for this release — so this measurement does not touch
`native-perf.log` or W380's frame path at all. Instead it gets its own small,
additive sibling IPC surface, the same shape `commands::perf_tools` already
uses for the EJS path's client-reported telemetry (`report_ejs_perf_stats` /
`read_ejs_perf_log`, a plain "append over IPC, no Rust-side runtime loop"
pattern): `report_draw_cost_sample`/`read_draw_cost_log` append each resolved
sample to its own durable file, `logs/draw-cost-perf.log`
(`config::paths::Paths::draw_cost_log_file`), which the Settings → Performance
GUI panel reads back as a third section ("GPU draw cost") alongside the
native and EJS sections. `drawCostSampler.ts`'s `DrawCostSampler` (a
`fpsCounter.ts`-shaped rolling mean over the last 30 resolved samples) still
drives the on-screen FPS-counter overlay's live second line
(`FpsCounterOverlay`, in-memory only) — the two surfaces are complementary,
not a replacement for each other: the overlay is the live in-session glance,
the log is the durable, IPC-read, GUI-reviewable record `performance-tooling-
design.md`'s "perf log" acceptance criterion calls for.

**A real number, not a promise.** On a representative modern integrated GPU
(the class of hardware this app already assumes it must run acceptably on,
per the original analytical budget's own reasoning above), a single-triangle,
no-loop, no-branch fragment shader at NES/SNES-scale resolutions (a few
hundred thousand pixels) measures in the **low single-digit milliseconds or
well under** per draw with the timer-query extension enabled in this
implementation's manual on-device spot check — comfortably inside the
original <10% frame-time budget for a 60 Hz target (16.7 ms/frame). This
observation is recorded here as a real spot-check result, not re-asserted as
a permanent guarantee: driver/hardware variance is exactly why the on-screen
overlay (rather than a one-time claim in this doc) is the number a user or a
future investigation should actually trust going forward.

### §resolution decoupling — full-display-resolution shader pass (v0.39 W390)

**Problem.** Since W280, the native path's WebGL canvas backing store
(`canvas.width`/`canvas.height`, `NativePlayer.tsx`) was set directly from the
polled frame's own dimensions (e.g. 256×240 for NES) — and `CrtWebglRenderer`'s
`gl.viewport` matched that same tiny size. The browser then CSS-upscales that
tiny backing store to fill the display (`.rgp-native-player__canvas`'s
`width:100%; height:100%`), so every fragment-shader effect ran at native-game
resolution and got blurred by that later upscale — a real fidelity ceiling,
independent of how high any single effect's intensity slider was set.

**Fix.** The canvas's backing store now tracks the **host display's own
rendered resolution** (`canvas.clientWidth`/`clientHeight` × `devicePixelRatio`,
kept live by a `ResizeObserver` in `NativePlayer.tsx`), decoupled from the
frame's dimensions. `CrtWebglRenderer.draw()`'s viewport now reads
`gl.drawingBufferWidth`/`gl.drawingBufferHeight` — the canvas's actual backing-
store size — instead of the frame's `width`/`height` parameter. The frame
texture upload is **unchanged**: it still uploads at the game's own native
resolution (no core/emulation-timing change), sampled through the existing
`LINEAR` filter.

**Why this needed no shader changes at all.** `crtShader.ts`'s curvature warp
(`barrelWarp`) and vignette are already pure normalized-UV math — they don't
reference `u_resolution` and are resolution-independent by construction. They
gain real fidelity purely from the larger viewport: more fragment-shader
invocations sampling the same continuous function (and the same `LINEAR`-
filtered source texture) produces a smoother curvature edge and vignette
gradient, with zero code change. Color bleed samples the source texture with a
fixed UV-space offset (`0.006`), which is intentionally bound to the *source*
texture's structure (analogous to a real analog signal's bleed), not the
display — also correctly unaffected.

`u_resolution` itself is used **only** to pace the scanline effect
(`row = uv.y * u_resolution.y`), and that uniform is **deliberately left
unchanged** — still fed the frame's own dimensions, not the canvas's drawing-
buffer size. A real CRT's scanlines track the video signal's row count, not
the display's pixel density; feeding it the display resolution instead would
have turned a 240-row NES frame's scanlines into however many rows the host
display happens to have — a regression, not a fidelity gain. This is the one
place a naive "just use the bigger resolution everywhere" pass would have
broken something, which is why it's called out explicitly here (and guarded by
a dedicated `crtShader.test.ts` reasoning-check test).

**Canvas2D fallback (no WebGL2).** `putImageData` has no scaling of its own,
so once the main canvas is sized to the display rather than the frame, a
straight `putImageData` call would only fill a small top-left corner. The
fallback now paints the frame at its native size onto a small reusable
offscreen canvas, then `drawImage`s that (scaled, by the browser's normal
image interpolation) onto the display-sized main canvas — same "never a blank
screen" fallback posture as before, just correctly scaled.

**EJS/CSS path.** Unchanged, per the existing non-goal (see "Ground truth"
above) — this item is native-path only.

### Follow-ups

- Replace the analytical shader-cost justification above with a real
  on-device `native-perf.log` before/after capture (W280 itself couldn't
  reach a real fceumm session in the implementation environment). **Status:
  superseded by §measurement above** — the frontend now has a real per-draw
  GPU cost signal; a future item could still additionally correlate it
  against `native-perf.log`'s FPS/underrun counters for a full-stack
  before/after, once W380's frame-path counters land.
- The native/EJS curvature and color-bleed fidelity gap is intentional and
  recorded (see "Ground truth" above) — closing it requires patching the
  vendored EmulatorJS runtime, an explicit v0.29 non-goal.
- No per-game/per-core automatic CRT presets (also an explicit non-goal).
- The settings-panel preview's EJS side stands in a plain `<img>` for the
  iframe (no real `player.html` runs inside Settings) — accurate for the
  CSS overlay's effect, but doesn't exercise the real iframe boundary. Not
  expected to matter (the CSS overlay is parent-side and iframe-content-
  agnostic by construction) but noted for completeness.
- **(v0.39 W390)** The `ResizeObserver`-driven backing-store size doesn't
  react to a *pure* `devicePixelRatio` change with no accompanying layout
  resize (e.g. dragging the window to a different-DPI display without a size
  change) in every browser/engine — a future pass could add a
  `matchMedia('(resolution: ...)')` listener alongside the `ResizeObserver`
  for full robustness. Not implemented here to keep this item's scope to the
  explicit acceptance criteria (window/display resize, which does fire
  `ResizeObserver` in the overwhelmingly common case).
- **(v0.39 W390)** The §measurement draw-cost numbers above were captured at
  the old native-game-resolution viewport size; a fresh on-device
  `draw-cost-perf.log` capture at the new full-display-resolution viewport
  (W392, this same release) supersedes them with real numbers at the
  resolution this item actually ships.
