# Release Planning — v0.23

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.23.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.23` |
| **Previous** | v0.22 (Polish — code-quality/UX audit pass, no new features) |
| **Theme** | "Continuity" — never lose progress, never lie to the user: save states + SRAM on both play paths, native-play closeout, visible fallbacks, truthful docs/license, and the scroll-driven attract mode on native NES playback. |

---

## 2. Major Features

### W230 — Native saves backend

Add `retro_serialize` / `retro_unserialize` / `retro_get_memory_data(RETRO_MEMORY_SAVE_RAM)`
to the libretro FFI (`src-tauri/src/play/native/ffi.rs`) and a new
`play/native/saves.rs` that persists battery SRAM and slot save-states to disk
under `app-support/saves/<system>/<game>.srm` / `.state<N>`. SRAM auto-flushes
on session exit and on a periodic interval; save/load-state IPC commands are
exposed for the overlay (W232).

- **Acceptance:** battery-backed NES games (e.g. The Legend of Zelda) retain
  progress across app restarts on the native path; save/load state round-trips
  through a slot file; unit tests cover the save-dir layout and SRAM flush;
  a serialize-unsupported core degrades gracefully (feature-detected).
- **Branch:** `feat/w230-native-saves`
- **Design:** `docs/design/save-persistence-design.md` (created by this item —
  covers the shared disk layout W231 also writes to).

### W231 — EmulatorJS save bridge

Bridge the in-page EmulatorJS path's SRAM and save-states out of the webview to
the same on-disk layout as W230, via the loopback server (`POST /saves/<id>`
endpoints on `play/server.rs`, wired from `player.html` using EmulatorJS's
save-data API). On boot, existing on-disk saves are loaded into the emulator so
the two paths share one save story.

- **Acceptance:** an in-page NES session's battery save survives app restart
  and lives in the same `saves/<system>/<game>.srm` file the native path uses;
  save-states round-trip; no regression when the server or EJS API is
  unavailable (silent best-effort, logged).
- **Branch:** `feat/w231-ejs-save-bridge`
- **Design:** extends `save-persistence-design.md` §EJS bridge.

### W232 — Save/load slots UI + Continue affordance

The in-game overlay (Resume / Full screen / Exit) gains **Save state** and
**Load state** entries with 4 timestamped slots, working on both play paths via
the W230/W231 IPC surface. The game detail page shows a "Continue" affordance
when a save exists (auto-save-state on exit produces the continue point).

- **Acceptance:** overlay save/load works by controller, keyboard, and mouse on
  both paths; slots show timestamps; exiting a session writes an auto-slot and
  the detail page then offers Continue, which boots and restores it.
- **Branch:** `feat/w232-save-slots-ui`
- **Design:** `save-persistence-design.md` §Slots & Continue.

### W233 — Native-play closeout (v0.21 stop-and-reassess)

Conclude the in-flight crash investigation: the working tree carries
uncommitted diagnostics (`log_step` breadcrumbs in `play/native/{host,runtime,callbacks}.rs`,
vendor `emulator.js` tweaks). Determine the investigation's outcome, land or
revert those changes deliberately, run the real-device verification deferred
from v0.21 (this machine has `fceumm_libretro.dylib` installed and real NES
ROMs), remove the temporary diagnostics, and decide/implement the
`native_play_enabled` default.

- **Acceptance:** no dangling uncommitted diagnostics; native NES boots on this
  machine producing frames + audio samples without crashing (programmatic
  check); the by-ear audio-cleanliness check is documented for the user with
  the result recorded; the flag default decision is recorded in
  `native-emulation-design.md` and implemented; v0.21 §5 follow-ups ticked.
- **Branch:** `feat/w233-native-play-closeout`
- **Design:** `native-emulation-design.md` (update §Verification).

### W234 — Honest play-path degradation

Surface play-path fallbacks in the UI: when the loopback server fails to bind,
when native init fails and falls back to EmulatorJS, or when no path can play a
title (no bundled core and no RetroArch), the game detail page shows a
dismissible notice naming what failed, what Harmony fell back to, and where to
fix it (Settings → Playback). Degradation reasons flow through a structured
field on the existing play IPC responses.

- **Acceptance:** forcing a bind failure or native-init failure produces the
  notice; the no-path case shows a clear error state instead of a dead button;
  normal operation shows nothing new; reasons are logged in one place.
- **Branch:** `feat/w234-honest-fallbacks`
- **Design:** extends `in-page-play-design.md` §Degradation surfacing.

### W235 — Attract mode (scroll-to-background live gameplay)

On the game detail page with native playback active, scrolling down hands the
live game canvas off to a fixed, full-bleed page-background layer — gameplay
(the boot/start attract sequence) keeps running, dimmed behind the page
content, with input detached and audio ducked (~30% volume). Scrolling back to
the top reattaches it as the foreground interactive player. Transitions use the
shared motion presets and honor reduced-motion.

- **Acceptance:** scrolling past the player smoothly migrates the live canvas
  to the background (same frame stream, no reboot); input is ignored while
  backgrounded and restored on reattach; audio ducks and restores; Escape/
  overlay behavior unaffected in foreground; reduced-motion gets a crossfade;
  EmulatorJS path is unaffected (explicitly out of scope this release).
- **Branch:** `feat/w235-attract-mode`
- **Design:** extends `native-emulation-design.md` §Attract mode (written by
  this item before implementation).

### W236 — Docs refresh (#25)

Rewrite the v0.1-era `README.md` to describe the shipped app (in-page play,
native NES path + flag, 20-console catalog, provider catalog/browse, consoles
view, TV ambitions); populate `docs/version-history.md` with one entry per
release v0.1–v0.22 (sourced from the roadmap's vX.Y sections); re-home the
v0.22 "JS-render fetch tier" carryover into the roadmap Backlog.

- **Acceptance:** README matches reality; version-history lists every release;
  doc-assurance checks pass.
- **Branch:** `feat/w236-docs-refresh`
- **Design:** n/a (doc-only).

### W237 — License follow-through (#26)

Declare Harmony's license as **GPL-3.0** (required in practice by bundling
EmulatorJS + fceumm into the distributable; user may override before the
release gate). Add `LICENSE`, set `license` fields in `package.json` /
`Cargo.toml` / `tauri.conf.json` where applicable, update
`THIRD-PARTY-NOTICES.md`, and resolve the GPL-incompatible UnRAR blob shipped
via `include_dir!` (drop `.rar` support or swap to a compatible extractor).

- **Acceptance:** LICENSE exists; manifests declare GPL-3.0; no
  GPL-incompatible code ships in the bundle; notices file has no open
  questions.
- **Branch:** `feat/w237-license`
- **Design:** n/a (compliance).

### W238 — Version bump + gates + release ritual

Bump to 0.23.0 (`tauri.conf.json`, `package.json`, `Cargo.toml`), run the full
gate suite (typecheck, lint, tests, build, `recipe.py smoke`), tick the ledger,
update roadmap (mark v0.23 released), archive into `version-history.md`.

- **Acceptance:** all gates green on `version/0.23`; ledger complete.
- **Branch:** `feat/w238-release-ritual`
- **Design:** n/a.

---

## 3. Parallel Implementation Strategy

| Phase | Items | Rationale |
|---|---|---|
| **1** | W233, W236, W237 | W233 stabilizes `play/native/*` and gates everything built on it; W236/W237 are disjoint doc/compliance work. |
| **2** | W230, W231 | Disjoint halves of the save story: `play/native/*` + new `saves.rs` vs `play/server.rs` + `player.html`. Both write the layout from `save-persistence-design.md` (scaffolded at phase-2 start, owned by W230). |
| **3** | W232, W234 | Both are frontend surfaces over settled backends. Conflict watch: both may touch `GameDetailPage.tsx` — merge W232 first, W234 rebases-by-merge after. |
| **4** | W235 | Touches `NativePlayer.tsx` + `GameDetailPage.tsx` + overlay after W232/W234 settle them. |
| **5** | W238 | Release closeout, alone. |

Conflict map: `play/native/*` (W233→W230→W235 serial by phases);
`play/server.rs` (W231 only); `GameDetailPage.tsx`/overlay (W232→W234→W235
serialized by phase order); docs (W236 alone; W238 ticks ledger only).

---

## 4. Out of Scope for v0.23

- **Rewind / fast-forward / volume / pause-on-blur** (#22) — v0.24 per roadmap.
- **In-page cores beyond NES** (#17) and the **boot-latency spike** (#14) — v0.24.
- **CRT/shader filters** (#23) — v0.28.
- **JS-render fetch tier** (v0.22 §4 carryover) — superseded by the fresh
  roadmap arc; re-homed to the roadmap Backlog by W236 rather than scheduled.
- **Attract mode on the EmulatorJS path** — native-only this release; the EJS
  iframe cannot share a canvas with the page without significant rework.
- **TV-UI epic #8** — v0.26/v0.27.

No open `Grimoire-Requirement` issues exist (checked this pass — tracker
returned zero).

---

## 5. Status Ledger

### Phase 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.23 |
|---|---|---|---|---|
| `feat/w233-native-play-closeout` (W233) | ☑ | ☑ | ☑ | ☑ |
| `feat/w236-docs-refresh` (W236) | n/a | ☑ | ☑ | ☑ |
| `feat/w237-license` (W237) | n/a | ☑ | ☑ | ☑ |

### Phase 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.23 |
|---|---|---|---|---|
| `feat/w230-native-saves` (W230) | ☑ | ☑ | ☑ | ☑ |
| `feat/w231-ejs-save-bridge` (W231) | ☑ | ☑ | ☑ | ☑ |

### Phase 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.23 |
|---|---|---|---|---|
| `feat/w232-save-slots-ui` (W232) | ☑ | ☑ | ☑ | ☑ |
| `feat/w234-honest-fallbacks` (W234) | ☑ | ☑ | ☑ | ☑ |

### Phase 4

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.23 |
|---|---|---|---|---|
| `feat/w235-attract-mode` (W235) | ☑ | ☑ | ☑ | ☑ |

### Phase 5

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.23 |
|---|---|---|---|---|
| `feat/w238-release-ritual` (W238) | n/a | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- **W233 found and fixed the v0.21 crash root cause:** `retro_init` was called
  before `retro_set_environment` (inside `LibretroCore::load`), violating the
  libretro contract — fceumm queries the environment during init and
  SIGSEGV'd on the null callback. The stub-core test missed it (empty init);
  it now queries the environment during init like a real core, plus two
  safe-Rust ordering guards with regression tests. Real-device run passed
  (SMB, 60.0988 fps, 256×240 frames, 48 kHz audio stream, clean exit).
- **W233 kept two investigation artifacts deliberately:** the once-per-command
  unhandled-environment log (cheap map of what cores ask for — feeds future
  core-coverage work) and the vendored EmulatorJS change that surfaces the
  WKWebView trusted-gesture start gate on desktop Safari-class hosts instead
  of silently playing garbled audio.
- **Native flag default stays off pending the maintainer's by-ear audio
  confirmation** (the 5 s verification played on speakers 2026-07-01); if
  confirmed clean, flip the default in W238 as a one-liner.
- **W236 folded the README license paragraph in** (declares GPL-3.0) since the
  W237 decision landed the same phase; the two items share README wording.
