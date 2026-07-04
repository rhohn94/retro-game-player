# Release Planning — v0.29.1

> status: agreed
> Hotfix release — single-item lane, abbreviated ritual. Captures the scope
> and ledger for the v0.29.1 native NES flip-fix. Archive into
> `version-history.md` when it ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.29.1` |
| **Previous** | v0.29 "Craft" |
| **Theme** | Fix a confirmed regression: native NES gameplay renders vertically flipped. User-reported 2026-07-04. |

**History:** W280 (v0.29) added a WebGL2 CRT-filter renderer on the native
play path (`src/features/play/crtWebglRenderer.ts` + `crtShader.ts`,
commit `d05c057`). It uploads each polled RGBA frame via `texImage2D` with no
`UNPACK_FLIP_Y_WEBGL`, and the vertex shader's UV math has no compensating
Y-invert. libretro/fceumm delivers frames top-down; the shader's `v_uv=(0,0)`
maps to the viewport bottom — so the frame renders as a full vertical mirror.
The prior Canvas2D `putImageData` fallback path is unaffected (`ImageData` is
natively top-down), which is why this is new in v0.29, isolated to the
WebGL2+native combination. Filed as
[#37](https://github.com/rhohn94/retro-game-player/issues/37).

---

## 2. Major Features

### W301 — Fix native NES Y-flip regression (#37)

**Description:** Compensate for the unflipped top-down source buffer in
exactly one place (either `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)` at
texture setup in `crtWebglRenderer.ts`, or invert V in `crtShader.ts`'s
vertex/fragment shader) so the WebGL2 CRT-filter path renders right-side-up.
Verify the fix doesn't break the barrel-warp/scanline effects that already
depend on the same UV math, and add a regression test that asserts actual row
order (not just that a texture upload occurred, which the existing
`crtWebglRenderer.test.ts` already does and would not have caught this).

**Acceptance criteria:**
- Native NES gameplay renders right-side-up with the WebGL2 CRT filter
  active, at every preset including Off.
- A regression test asserts row order, not just texture-upload invocation.
- Existing CRT-effect tests (barrel warp, scanlines, phosphor) still pass —
  confirm the fix didn't invert their own UV-dependent math.

**Branch:** `fix/w301-nes-flip-fix`
**Design doc:** none required — this is a targeted bug fix within the scope
already documented in `docs/design/architecture-fitness-design.md`'s sibling,
the CRT-filter design doc introduced by W280 (whichever doc that landed in;
if a design doc exists for W280, add a short "Post-W280 hotfix" note there
per the `core-options-design.md` precedent from W282).

---

## 3. Parallel Implementation Strategy

Single work item, single pass — no conflict map needed.

| Pass | Branch | Touches |
|---|---|---|
| 1 | `fix/w301-nes-flip-fix` | `src/features/play/crtWebglRenderer.ts`, `src/features/play/crtShader.ts`, `src/features/play/crtWebglRenderer.test.ts` (or a new test file) |

---

## 4. Out of Scope for v0.29.1

- Any change to the native FFI frame-delivery layer (`src-tauri/src/play/native/frame.rs`) — the source buffer's top-down convention is correct and standard; only the GL consumption side needs to compensate.
- Whether the EmulatorJS/iframe play path has an analogous issue — out of scope for this investigation and this hotfix; file separately if discovered.
- Any change to CRT filter presets/UX — this is a rendering-correctness fix only.

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.29.1 |
|---|---|---|---|---|
| `fix/w301-nes-flip-fix` (W301) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

(empty at start; populated by release-phase-merge as branches land)
