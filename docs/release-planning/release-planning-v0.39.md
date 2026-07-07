# Release Planning — v0.39

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.39.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.39` |
| **Previous** | v0.38 "Tune-Up" (frame-path perf, achievement list, collections management, a11y) |
| **Theme** | **"Focus"** — decouple the native-path CRT filter's rendering resolution from the emulated game's frame resolution, so the shader's scanline/curvature/color-bleed/vignette effects render at full host-display fidelity instead of being computed at the game's tiny native resolution and blurred by a later CSS/canvas upscale. |

---

## 2. Major Features

### W390 — CRT renderer resolution decoupling (flagship)

**Description:** `CrtWebglRenderer` currently sizes its WebGL viewport
(`gl.viewport`) and `u_resolution` uniform to the polled game frame's raw
dimensions (e.g. 256×240 for NES) because `NativePlayer.tsx` sets the
canvas's backing store (`canvas.width`/`canvas.height`) directly from
`frame.width`/`frame.height`. The browser then CSS-upscales that tiny
backing store to fill the display, so every shader effect (barrel warp,
scanline pitch, vignette falloff) is computed at native-game resolution and
loses fidelity in the subsequent upscale.

This item decouples the two: the canvas's WebGL backing store is sized to
the host display's actual rendered size (`clientWidth`/`clientHeight` ×
`devicePixelRatio`), independent of the game frame's dimensions. The frame
texture is still uploaded at the game's own native resolution (the game
itself keeps rendering at its system-native resolution — no core/emulation
change), sampled with the existing `LINEAR` filter for the base-image
upscale, but the shader's `u_resolution` and all destination-space math
(scanline row pitch, curvature warp, vignette falloff) operate against the
canvas's real backing-store size, giving the effects genuine high-resolution
detail rather than an upscaled blur. A resize observer keeps the backing
store in sync with window/display size changes (new — today the canvas only
resizes on a frame-dimension change, i.e. a core renegotiation).

**Acceptance criteria:**
- `NativePlayer.tsx`'s canvas backing store tracks the host display's
  rendered size (× `devicePixelRatio`), not the game frame's dimensions;
  resizing the window/display updates it.
- `CrtWebglRenderer.draw()` accepts the frame's texture dimensions and the
  canvas's output dimensions as distinct values; `gl.viewport` and
  `u_resolution` use the output dimensions.
- `crtShader.ts`'s scanline pitch, curvature warp, and vignette falloff read
  from the destination-resolution uniform; the `0` intensity → passthrough
  invariant still holds (existing reasoning-check test).
- No change to core emulation timing, frame texture content, or the
  EJS/CSS-approximation path (`CrtCssOverlay.tsx` — explicit v0.29 non-goal,
  unchanged).
- Existing `crtWebglRenderer.test.ts` / `crtShader.test.ts` suites extended
  to cover the decoupled-resolution and resize-observer behavior.

**Branch:** `w390-crt-resolution-decoupling`
**Design doc:** `docs/design/crt-filter-design.md` (extend, see W391)

---

### W391 — Design doc extension: resolution-decoupling architecture

**Description:** Add a new section to `crt-filter-design.md` documenting the
resolution-decoupling architecture (backing-store sizing, texture-vs-viewport
split, resize handling), and record the EJS/CSS path as explicitly unchanged
(reaffirming the existing v0.29 non-goal rather than silently dropping it).

**Acceptance criteria:**
- New `crt-filter-design.md` section describing the architecture and the
  rationale (why native-game-resolution shader math produced a fidelity
  ceiling).
- Explicit non-goal note: EJS/CSS path unchanged, still gated on a future
  `player.html` patch (unchanged from v0.29).

**Branch:** `w391-crt-design-doc` (or folded into W390's branch if the
implementing agent finds the doc update trivially co-located — decided at
dispatch time)
**Design doc:** `docs/design/crt-filter-design.md` (this item *is* the doc
update)

---

### W392 — Perf verification: full-resolution GPU draw-cost

**Description:** Use the existing W381 GPU timer-query telemetry
(`report_draw_cost_sample` / `read_draw_cost_log`, `draw-cost-perf.log`) to
capture a before/after (or best-available analytical, if no live on-device
session is reachable in the implementation environment — same constraint
recorded in W280/W381) comparison of draw cost at the new, larger
full-display-resolution viewport vs. the old native-game-resolution
viewport, confirming the shader pass stays within the existing documented
frame-time budget (<10% average frame-time increase, per
`crt-filter-design.md`).

**Acceptance criteria:**
- A recorded draw-cost comparison (real capture preferred; analytical
  fallback explicitly labeled as such, consistent with existing doc
  precedent) added to `crt-filter-design.md`'s §measurement.
- No change required to `native-perf.log`'s FPS/underrun counters (same
  structural isolation argument as W280 — the shader cost lives entirely in
  the browser/GPU compositor paint step).

**Branch:** `w392-crt-perf-verification`
**Design doc:** `docs/design/crt-filter-design.md`

---

### W393 — Visual verification: before/after evidence

**Description:** Use the existing visual-inspection CLI / ux-demo tooling to
capture before/after screenshots at a representative preset (e.g. "Classic
CRT") showing the fidelity improvement — native-game-resolution shader
(blurred by later upscale) vs. full-display-resolution shader (sharp
curvature/scanline detail) — attached as evidence in the design doc or
release notes.

**Acceptance criteria:**
- Before/after screenshots captured and referenced from
  `crt-filter-design.md` or the version-history entry.
- No new visual-inspection infrastructure introduced; reuses the existing
  `gui-visual-inspection-cli` tooling.

**Branch:** `w393-crt-visual-verification`
**Design doc:** `docs/design/crt-filter-design.md`

---

## 3. Parallel Implementation Strategy

**Pass 1 (parallel, no file overlap with each other):**
- W390 (code: `crtWebglRenderer.ts`, `crtShader.ts`, `NativePlayer.tsx`,
  their test files) — the only item touching implementation code.

**Pass 2 (sequenced after W390 merges, since each depends on its landed
behavior to measure/document/screenshot):**
- W391 (doc-only extension of `crt-filter-design.md`)
- W392 (perf verification, depends on W390's landed renderer)
- W393 (visual verification, depends on W390's landed renderer)

W391/W392/W393 all touch `crt-filter-design.md` (W391 adds the architecture
section; W392/W393 add their own sub-sections) — dispatch sequentially
within Pass 2, or merge in W391 → W392 → W393 order to avoid doc-section
conflicts, per the conflict map below.

**Conflict map:**
| Branch | Files touched |
|---|---|
| `w390-crt-resolution-decoupling` | `crtWebglRenderer.ts`, `crtShader.ts`, `NativePlayer.tsx`, associated `*.test.ts` |
| `w391-crt-design-doc` | `crt-filter-design.md` (architecture section) |
| `w392-crt-perf-verification` | `crt-filter-design.md` (§measurement addendum) |
| `w393-crt-visual-verification` | `crt-filter-design.md` (evidence addendum) |

---

## 4. Out of Scope for v0.39

- **EJS/CSS-approximation path changes** — patching the vendored
  EmulatorJS `player.html` to expose its internal canvas for a true
  per-pixel shader remains an explicit v0.29 non-goal, unaffected by this
  release.
- **CRT shader variants / new effect types** (scout #8, carried in v0.38 §4)
  — a different concept (new filter styles) from this release's resolution
  fidelity fix; still deferred.
- **RA server submission / leaderboards, IPC frame-transport redesign,
  i18n, collections polish, Vulkan HW-render (#50), fleet self-update
  (#39), Aura upstream types (#40), docs debt (#44/#51), metadata
  enrichment (#24), natural-language search (#47), placeholder art (#46)**
  — unrelated to this focused release's scope; unchanged backlog, carried
  from v0.38 §4.
- **Grimoire-Requirement items** — none open at planning time (tracker read
  returned zero, 2026-07-07).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.39 |
|---|---|---|---|---|
| `w390-crt-resolution-decoupling` (W390) | ☐ | ☐ | ☐ | ☐ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.39 |
|---|---|---|---|---|
| `w391-crt-design-doc` (W391) | ☐ | ☐ | ☐ | ☐ |
| `w392-crt-perf-verification` (W392) | ☐ | ☐ | ☐ | ☐ |
| `w393-crt-visual-verification` (W393) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

_(empty at start; populated by release-phase-merge as branches land)_
