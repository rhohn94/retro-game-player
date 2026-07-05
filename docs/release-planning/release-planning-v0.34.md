# Release Planning — v0.34

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.34.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.34` |
| **Previous** | v0.33 (Bottles — CrossOver source + launch, H2 first slice) |
| **Theme** | "Engines" — every popular platform plays on the native emulation engine: generalize the v0.21 NES-only native libretro host into a multi-system engine (SNES, Genesis, GB/GBC/GBA, PS1, N64, and more), with GameCube/Wii as the HW-render stretch. |

User directive (2026-07-05): expand native emulation playback, like NES,
to SNES, N64, PS1, GameCube, Wii, and other popular platforms. A follow-on
v0.35 (two-controller multiplayer for NES/SNES) is planned immediately after,
so controller/input-mapping work stays out of v0.34 unless foundational.

Grounding facts (planning read, 2026-07-05):

- Native hosting is NES-only (`play/native/core_path.rs` `NATIVE_SYSTEM`);
  SNES/Genesis/MasterSystem/N64/PS1/Atari2600/PCEngine already play in-page
  via EmulatorJS/WASM (v0.24), so for them this release is a path upgrade
  (clean CoreAudio audio, no WASM compile, fast boot), not first playability.
- GB/GBC/GBA are absent from the system catalog entirely (v0.10 scoped home
  consoles); Wii (gen 7) is absent; GameCube is catalogued (`dolphin`).
- The native host negotiates all three libretro pixel formats and supports
  full-path ROM loading, but has **no HW-render (OpenGL) support** — which
  the N64/GameCube/Wii cores require. That is this release's major subsystem.
- PS1 is scanned only as `.pbp`; disc formats (`.cue`/`.chd`/`.bin`) are
  unscanned (ambiguous-extension rule), so PS1 native playback needs
  disc-image identification to matter.

---

## 2. Major Features

### W340 — Native host generalization (multi-system engine)

Replace the single hard-wired `NATIVE_SYSTEM: "nes"` with a table of
native-hostable systems. Core `.dylib` resolution goes through the existing
`CoresRepo::installed_path` per system (same install pipeline as today);
video geometry (width/height/aspect) and timing (fps, sample rate) are taken
from each core's `retro_get_system_av_info` instead of NES assumptions;
the frontend native-path gate (`nativePath.ts` / `PlaySwitch.tsx`) consults
the table + core-installed state instead of `system === "nes"`.

- **Acceptance:** NES behaves exactly as today (regression tests intact);
  a second software-rendered system boots through the same host in a test
  with a stub core reporting non-NES geometry/timing; frontend routes a
  native-capable system with an installed core to `NativePlayer`, and falls
  back to EJS/external when the core is missing or init fails.
- **Branch:** `w340-native-host-generalization`
- **Design:** `native-emulation-design.md` — new §Multi-system engine.

### W341 — Catalog expansion: handhelds + Wii

Add `gb`, `gbc`, `gba` (and `wii`) to `system_map.rs` (cores: gambatte /
gambatte / mgba; wii: dolphin), `mapper.rs` scan extensions (`gb`, `gbc`,
`gba` unambiguous; `wbfs` → wii, `rvz` stays gamecube), console-browse
specs/art entries, and the EJS on-demand core catalog (`play/ejs_cores.rs` +
`src/features/play/ejs.ts`) so handhelds get the EJS fallback tier too.

- **Acceptance:** scanning a folder with `.gb`/`.gbc`/`.gba` files produces
  library rows with correct system + default core; Cores screen offers the
  new systems' cores (ids verified against the arm64 buildbot index);
  handheld EJS fallback entries resolve in `inPageAvailability`; console
  browse shows the new consoles without layout regressions.
- **Branch:** `w341-handheld-wii-catalog`
- **Design:** `console-catalog-design.md` — extension section;
  `in-page-play-design.md` §7 note.

### W342 — Software-render native cohort

Enable the native path for the software-rendered cores: **snes** (snes9x),
**genesis** + **mastersystem** (genesis_plus_gx), **gb/gbc** (gambatte),
**gba** (mgba), **atari2600** (stella), **pcengine** (mednafen_pce). Per-core
verification of pixel format, geometry (including mid-game geometry changes
via `SET_GEOMETRY`), and timing; per-system entries added to the W340 table.

- **Acceptance:** each cohort system boots a ROM through the native host in
  the stub/fixture test harness; on-device spot check for at least SNES +
  GBA recorded (or filed as human follow-up, matching v0.21 precedent);
  EJS fallback remains automatic on native-init failure.
- **Branch:** `w342-software-native-cohort`
- **Design:** `native-emulation-design.md` §Multi-system engine table.

### W343 — Disc-image identification (PS1 scanning)

Content-sniffing identification for ambiguous disc containers so PS1 discs
enter the library: `.cue` (parse + sniff referenced `.bin` for PlayStation
signature / SYSTEM.CNF), `.chd` (header metadata), bare `.bin` sniff.
Conservative: only claims a system on a positive signature; everything else
stays unscanned exactly as today.

- **Acceptance:** fixture `.cue`/`.bin` and `.chd` PS1 images scan to
  `ps1` rows; non-PS1 `.bin` fixtures stay unidentified; multi-track cue
  sheets resolve to one game row (the `.cue` is the canonical file);
  existing unambiguous-extension scanning is unchanged.
- **Branch:** `w343-disc-image-identification`
- **Design:** `library-identification-design.md` — new §Disc-image sniffing.

### W344 — PS1 native enable

Enable `ps1` on the native engine via pcsx_rearmed: full-path ROM load
(`need_fullpath`), HLE-BIOS by default with an honest in-UI notice when a
title likely needs a real BIOS, single-disc scope (no disk-control swap UI).

- **Acceptance:** a PS1 fixture/homebrew image boots natively in the test
  harness; BIOS-notice copy shows on the PS1 detail page; multi-disc games
  play disc 1 with the swap limitation documented; EJS fallback intact.
- **Branch:** `w344-ps1-native`
- **Design:** `native-emulation-design.md` §Multi-system engine (PS1 note).

### W345 — HW-render subsystem + N64 native

Add libretro HW-render support to the native host: honor
`RETRO_ENVIRONMENT_SET_HW_RENDER` (OpenGL / GL core profile), create a
headless CGL/NSOpenGL context on the core thread, provide
`get_current_framebuffer`/`get_proc_address`, render into an FBO, and read
pixels back into the existing frame-IPC pipe (canvas path unchanged).
Enable `n64` (mupen64plus_next) on it.

- **Acceptance:** an N64 ROM boots and renders through the native host on
  device (this item is explicitly on-device-gated; if blocked, the blocker
  is filed as an issue with findings and the branch ships the HW-render
  layer dark); readback throughput at 640×480@60 does not regress the
  frame pipe; software-render systems are untouched (context only created
  when a core requests HW render); EJS N64 fallback intact.
- **Branch:** `w345-hw-render-n64`
- **Design:** `native-emulation-design.md` — new §HW-render.

### W346 — GameCube/Wii native (stretch)

Attempt dolphin-libretro on the W345 HW-render layer for `gamecube` + `wii`.
Honest-outcome scope: acceptance is *either* a booting GC/Wii title *or* a
documented blocker (core availability on the arm64 buildbot, Vulkan-only
requirement, dolphin-libretro abandonment) filed as an issue, with the
external-launch path (RetroArch/Dolphin) remaining the supported route and
the detail page saying so honestly.

- **Acceptance:** as above — boots, or a filed blocker issue + honest UI
  copy; no regression to any other system either way.
- **Branch:** `w346-gamecube-wii-native`
- **Design:** `native-emulation-design.md` §HW-render (GC/Wii note).

### W347 — v0.33 reviewer riders

Three small carry-ins from the v0.33 §5 follow-ups: `--` argument
terminator before `target` in `cxstart_args`; reconcile W332 doc comments
(`external.rs` module reference, `AppError::Dependency` wording); prefer the
launcher stub's `CFBundleIdentifier` for CrossOver `external_id` when
present (display-name fallback intact, no migration needed — re-scan mints
the stable id).

- **Acceptance:** each rider covered by a unit test or doc diff; CrossOver
  re-scan with a bundle-id stub keys on the bundle id.
- **Branch:** `w347-v033-riders`
- **Design:** `crossover-integration-design.md` (touch-up only).

---

## 3. Parallel Implementation Strategy

Three passes, dependency-ordered:

| Pass | Items | Rationale |
|---|---|---|
| P1 | W340, W341, W347 | Foundations. W340 owns `src-tauri/src/play/native/*` + `src/features/play/nativePath.ts`/`PlaySwitch.tsx`; W341 owns `system_map.rs`/`mapper.rs`/console data/EJS catalog; W347 owns CrossOver files. No file overlap. |
| P2 | W342, W343, W345 | W342 (needs W340's table + W341's systems) owns the table entries + per-core glue; W343 owns scanner/identification; W345 (needs W340) owns new HW-render module + callbacks env arm. W342/W345 both touch `play/native/` — W342 stays in the systems table + per-core notes, W345 adds new files + one env-callback arm; merge W342 before W345. |
| P3 | W344, W346 | W344 needs W343 + W342; W346 needs W345. Both are narrow enables on settled layers. |

Merge order within each pass = ledger order. Conflict map: the only shared
surface is `play/native/` between W342/W345 (P2, ordered) and the W340 table
consumed by later items (append-only rows).

---

## 4. Out of Scope for v0.34

- **Two-controller / multiplayer input** — the entirety of v0.35, next.
- **Guided "run a Windows game" CrossOver flow** — was the v0.33-era v0.34
  candidate; superseded by this user-directed scope. Future-version candidate.
- **Netplay, RetroAchievements** — backlog, unchanged.
- **Save-state/rewind parity for the native path beyond what exists** —
  follow-up in `native-emulation-design.md`, not this release.
- **Disk-control (multi-disc swap) UI for PS1** — disc 1 only this release.
- **Native NSView/Metal frame overlay** — canvas/IPC pipe stays; the W345
  FBO readback feeds the existing pipe.
- **PS2, Saturn, Dreamcast, 3DO, Jaguar, Neo Geo native hosting** — remain
  EJS/external; candidates once the HW-render layer proves out.
- **Wii-specific input (Wiimote pointer/motion)** — even if W346 boots,
  input is controller-mapped classic-profile only; motion is unscheduled.
- **Grimoire-Requirement items** — none open at planning time (tracker read
  returned zero, 2026-07-05).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.34 |
|---|---|---|---|---|
| `w340-native-host-generalization-v034p1-00` (W340) | ☑ | ☑ | ☑ | ☑ |
| `w341-handheld-wii-catalog-v034p1-01` (W341) | ☑ | ☑ | ☑ | ☑ |
| `w347-v033-riders-v034p1-02` (W347) | n/a | ☑ | ☑ | ☑ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.34 |
|---|---|---|---|---|
| `w342-software-native-cohort-v034p2-00` (W342) | ☑ | ☑ | ☑ | ☑ |
| `w343-disc-image-identification-v034p2-01` (W343) | ☑ | ☑ | ☑ | ☑ |
| `w345-hw-render-n64-v034p2-02` (W345) | ☑ | ☑ | ☑ | ☑ |

### Pass 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.34 |
|---|---|---|---|---|
| `w344-ps1-native-v034p3-00` (W344) | ☑ | ☑ | ☑ | ☑ |
| `w346-gamecube-wii-native` (W346) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

- **Pass-1 note:** dispatched via the write-capable workflow
  (`release-phase-model: Auto`); branch names carry the `-v034p1-NN` suffix.
- Reviewer (W341, non-blocking): `inPageAvailability.ts` `SYSTEM_LABELS` not
  extended — get-core panel copy reads raw "gb"/"gbc"/"gba" instead of
  friendly names (out-of-lane file; cheap fix for a later rider).
- Reviewer (W341, non-blocking): `src/features/tv/systems.ts` header claims a
  COMPLETE label table which the new systems falsify — Wii rail renders
  fallback "WII"; add labels + fix the stale claim.
- Reviewer (W341, non-blocking): add a direct
  `inPageAvailability("gba", …)` test case (criterion currently covered only
  transitively via `inPageSystem`).
- Reviewer (W341, cosmetic): `ejs_cores.rs` license string "GPLv2+" breaks
  the SPDX-ish style — use "GPL-2.0-or-later".
- Reviewer (W340, blocking — **fixed on branch, a0e94a4**): the stub-core
  pacing test was vacuous (wall-clock assertion included the sleep);
  replaced with a frame-sequence tick-delta check that discriminates 50 fps
  from NES's 60.0988 fps.
- Reviewer (W340, non-blocking): `PlaySwitch` now blanks every system (not
  just NES) until `list_native_systems` answers — small universal
  mount-latency regression; consider optimistic render for EJS-only systems.
- Reviewer (W340, non-blocking): `list_native_systems_at` test helper
  duplicates the command body — extract a plain `fn(&Db)` the
  `#[tauri::command]` delegates to.
- Reviewer (W340, non-blocking): `GeometryChanged.aspect_ratio` is logged
  but not propagated — a core changing aspect without changing pixel
  dimensions renders wrong; **must be addressed by W344/W345** (PS1/N64 are
  exactly where this happens).
- Reviewer (W340, cosmetic): `start_native_play` double table lookup
  (`native_support_for` then `resolve_native_core_path` repeats it).
- Reviewer (W347, blocking — **fixed on branch, 479b2bd**): raw-bundle-id
  external_id would have duplicated every existing CrossOver row on
  re-scan (upsert-only pipeline, no prune) and collided the same app across
  bottles; fixed as bottle-scoped `<bottle>/<CFBundleIdentifier>` with a
  pre-upsert legacy re-key pass (`rekey_game_external_id`), DB-transition
  tested.
- Reviewer (W347, informational): whether the real `cxstart` binary honors
  the `--` terminator rides on the standing on-device CrossOver human
  follow-up (fixture-validated only).
- Master (Pass-1 completion): W340's `list_native_systems` had no mock-IPC
  fixture — smoke gate caught it; fixed on `fix-mock-ipc-native-systems`
  (a1e7a2a). Note for W342/W345 agents: extend that fixture if capability
  shape changes. `pnpm tauri build` compiles + bundles the .app; the
  built-in `bundle_dmg.sh` step fails in the sandboxed session (Finder
  access) — release DMG goes through `recipe package`
  (`release_sign_notarize.py`), the v0.33 #45 pipeline.
- Reviewer (W342, non-blocking): stale test name in systems.rs module doc
  (`every_native_row…` vs actual `every_cohort_row…`).
- Reviewer (W342, non-blocking): cohort pixel-format boot test has a flake
  window — stub renegotiates 4x4→8x8 at tick 3 and `latest_frame()` could
  observe either; accept both sizes to deflake if CI flakes.
- Reviewer (W342, non-blocking): pixel-format attributions disagree between
  the design-doc table and the stub's doc comment — align the two.
- Reviewer (W342, backlog): native host pins the recommended default core,
  ignoring the user's *active* core choice (bsnes-active user still needs
  snes9x for native play) — pre-existing v0.21 posture scaled to 9 systems;
  candidate UX note for the Cores screen.
- Reviewer (W343, blocking ×5 — **all fixed on branch, 7be49a8**): original
  sniffing missed real PS1 dumps (cooked-only sector assumption, licence
  string in the wrong region, unspaced `BOOT=` marker, inert CHD path,
  first-bin-only cue claiming, unbounded full-file hash). Reworked against
  real dump layouts (ECMA-130 raw 2352 + cooked 2048, PVD System
  Identifier + `BOOT`-not-`BOOT2` discriminator, case-insensitive all-FILE
  claiming, 16 MiB prefix-window hashing).
- W343 documented limitation: real PS1 `.chd` images are NOT identified in
  v0.34 (needs hunk decompression) — filed as
  [#49](https://github.com/rhohn94/retro-game-player/issues/49).
- Reviewer (W343, non-blocking, remaining): disc-row hashes are
  prefix-window hashes (no DAT matching for disc rows); scanned-counter
  semantics differ between passes (recorded, not fixed).
- Reviewer (W345, blocking ×2 — **both fixed on branch, eba85a2**): stale
  merge base predating W342 (resolved by merge-forward, no W342 content
  lost) and an inverted `bottom_left_origin` row-flip that would have
  rendered N64 upside-down (fixed; E2E stub now draws asymmetric bands and
  the test fails under the inverted condition).
- W345: live-GL tests are env-gated (`RGP_LIVE_GL_TESTS=1 cargo test --
  --ignored hw_render`); all 6 passed on this machine. On-device N64
  boot with a real ROM remains tracked as
  [#48](https://github.com/rhohn94/retro-game-player/issues/48).
- W345 addressed the W340 follow-up: aspect-ratio now propagates through
  the frame header (16→20-byte, additive) into NativePlayer rendering.
- Reviewer (W344, non-blocking): `Ps1BiosNotice` duplicates `PlayNotice`
  markup verbatim — extract a shared presentational banner.
- Reviewer (W344, non-blocking): positional NATIVE_SYSTEMS tests
  (`n64_precedes_ps1…`, `ps1_is_the_last_row…`) will break on any future
  row append — make them order-insensitive when next touched.
- Reviewer (W344, follow-up): `mock-ipc.mjs` `list_native_systems` fixture
  stale (nes-only) since W342/W345 — smoke never exercises non-NES native
  routing or the PS1 notice; sync the fixture with NATIVE_SYSTEMS.
