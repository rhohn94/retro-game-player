# Runtime Verification Design — Visual Inspection + Smoke (v0.1, hardened v0.2)

> **Up:** [↑ Design docs](README.md)
>
> **v0.2 "Sight" update:** the capture now *verifies* the GUI actually renders
> (it previously only proved a file existed — see [§v0.2 hardening](#v02-hardening--verified-rendering--mock-ipc)).

> **Status:** W18 deliverable. Documents Harmony's **visual-inspection CLI**
> (the framework-required `gui-visual-inspection-cli` capability — see
> [../roadmap.md](../roadmap.md) §Framework-required) and how the `smoke` recipe
> target exercises the served UI surface CI-safely. Consumes the build seam
> fixed in [architecture-design.md](architecture-design.md) and renders the UI
> language fixed in [ux/design-language.md](ux/design-language.md).

## Motivation

Harmony is a Tauri 2 app: a Rust shell hosting a Vite-built React SPA. The
native window cannot open in headless CI (no display server, no GPU surface),
so we cannot screenshot the real Tauri window there. But the **entire UI is the
web SPA** — the Rust shell only loads `dist/` over a custom protocol. So the
faithful, CI-safe way to visually inspect the app is to render that built bundle
in a headless browser and capture an artifact. This gives every downstream agent
and the merge gate a deterministic "did the UI render?" check without a GUI
window, RetroArch, or network access.

## Goals

- A **non-interactive** command that captures a render of the running app UI to
  a known file path and exits 0 on success.
- Produce a **real artifact**: a PNG screenshot when a headless browser is
  available, plus a DOM dump and a machine-readable report — always at least one
  artifact.
- Make `recipe.py smoke` **green** for the served UI surface: build the bundle,
  render it headlessly, and assert the artifact exists.
- CI-safe: no GUI window, no RetroArch, no network.

## Non-goals

- Screenshotting the real native Tauri window (not possible headless; deferred).
- Pixel-diff / visual-regression baselines (a later iteration may layer these on
  top of the captured PNG).
- Driving controller/gamepad input through the captured page.

## The visual-inspection CLI

Implementation: `scripts/visual-inspect.mjs`. Invoked as `node
scripts/visual-inspect.mjs`, or via the `inspect` recipe target, or
`pnpm inspect`. It assumes `dist/` is already built (exits 2 otherwise).

Pipeline:

1. **Serve** the built `dist/` over a loopback HTTP server (ephemeral port,
   `127.0.0.1` only). A minimal static server with SPA fallback to `index.html`
   so the hash-router app boots — no `vite preview`, no fixed port.
2. **Render** in headless Chromium via `playwright-core` (a devDependency that
   ships *no* browser binary — it drives an existing one). The executable is
   resolved without any network download, in priority order:
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE` → a cached `ms-playwright` build
   (`chromium_headless_shell-*` / `chromium-*`) → system Google Chrome →
   `playwright-core`'s own resolved path. The page is loaded, given a beat to
   mount and paint, then a PNG screenshot and the rendered DOM are captured.
3. **Fallback**: if no headless browser can be launched, the command copies the
   static built `index.html` as the DOM artifact so an artifact still exists and
   the command still exits 0. The report records `mode: "static-fallback"`. This
   keeps smoke green on machines with no browser; the limitation is that no live
   render/PNG is produced there.

Artifacts (under `artifacts/visual-inspection/`, git-ignored):

| File | When | Contents |
|---|---|---|
| `screenshot.png` | browser mode | PNG screenshot of the rendered SPA (1280×832 @2x) |
| `dom.html` | always | rendered DOM (browser mode) or static `index.html` (fallback) |
| `report.json` | always | `{capability, mode, ok, artifacts, screenshotPath, domPath, detail, capturedAt}` |

The command exits `0` on a produced artifact, `1` if none could be produced, and
`2` if `dist/` is missing.

## How smoke works

`recipe.py smoke` (`.claude/recipes.json` → `smoke`) chains, all CI-safe:

```
pnpm build                                         # build the web bundle (tsc + vite)
&& cargo check --manifest-path src-tauri/Cargo.toml # type-check the Rust shell
&& node scripts/visual-inspect.mjs                  # render + VERIFY the GUI (exits 1 if blank/crashed)
```

The `inspect` target is the capture alone (it runs `pnpm build` first for
standalone use). W1 owns the base recipe file; W18 extended the existing `smoke`
target and appended the `inspect` target. In v0.2 the trailing `test -f` artifact
check was dropped — the script's own exit code is now the gate (see below).

## v0.2 hardening — verified rendering + mock IPC

**Why.** v0.1's smoke reported success whenever any artifact file existed. The
app shipped completely blank — React never mounted because importing the Aura
runtime as a deferred ES module fired its internal `ready()` callback before
`Aura.icons` was defined, throwing `Cannot read properties of undefined (reading
'names')` and aborting the entry module. Smoke stayed green throughout, because
a `dom.html` file was still produced. The capture was screenshotting a bug.

**What changed.** `scripts/visual-inspect.mjs` now:

1. **Captures** browser `console` errors and uncaught `pageerror`s, and **fails
   the gate on any uncaught error** — the exact signal that was invisible before.
2. **Asserts the GUI rendered on every route** — React mounted into `#root`,
   the shell chrome is present, and the route's expected text shows — and exits
   **non-zero** when any route is blank. (Proven: hiding the JS bundle makes all
   four routes report `FAIL` and the command exit 1.)
3. **Injects a mock Tauri IPC layer** (`scripts/mock-ipc.mjs`) before the app
   boots, so `window.__TAURI_INTERNALS__.invoke` returns deterministic fixtures
   and screens render **populated** instead of "Could not load…" error states.
   `scripts/mock-ipc.test.mjs` guards the fixtures against DTO drift.
4. **Walks all primary routes** (Library / Cores / Search / Settings) and
   screenshots each to `artifacts/visual-inspection/<route>.png`, plus the
   machine-readable per-route verdicts in `report.json`.

**Graceful degradation.** With no headless browser, the static fallback still
produces a DOM artifact and exits 0, but the report records `verified:false` so
the unverified state is explicit rather than a false pass.

The runtime crash fix itself lives in `vite.config.ts` (the Aura runtime is
loaded as a classic render-blocking `<head>` script so its `ready()` defers
correctly) and the CSS cascade-layer ordering in `src/styles/layer-order.css`.

## Validation

On the development machine smoke runs in **browser mode**: a real ~0.8 MB PNG of
the Harmony shell (HeroBackdrop vibrancy over the routed first screen) plus the
rendered DOM and `report.json`. `pnpm build` and `pnpm typecheck` stay green.
The script is dependency-light (`playwright-core` + Node stdlib) and the static
fallback guarantees a green smoke even where no browser is installed.

## v0.29 (W284) — play-path + play-adjacent IPC integration coverage (#28)

**Why.** The visual-inspection CLI above proves the *served UI shell* renders;
it says nothing about whether an actual game boots, produces frames, or plays
audio. Before W284 the three play paths (EmulatorJS loopback, native libretro
hosting, RetroArch launch) and the growing play-adjacent IPC surface (55+
commands by v0.29, including three new command groups added earlier in this
same release — CRT filter config, performance-tooling logs, per-core options)
had zero integration-level coverage: every existing test exercised either pure
domain logic or the HTTP router function directly, never the real public
entrypoints (`play::server::start`, `play::native::NativeRuntime::start`) a
production boot actually calls. A broken player or a broken IPC command could
ship with every gate green — exactly the v0.1 "shipped blank" failure mode
this design doc exists to close, just one layer deeper (served UI vs. the
play surface underneath it).

**What changed.** No new test framework or crate-root `tests/` directory —
this crate's established convention is `#[cfg(test)] mod tests` inline in the
same file as the code under test (see `play/server.rs`, `play/native/host.rs`,
`core/core_options/probe.rs` pre-W284), so the new coverage below follows that
convention exactly, landing in the same files:

1. **Loopback play-server integration** (`play/server.rs`,
   `start_boots_a_real_server_serving_player_html_rom_and_healthz`). Boots the
   server through its real public entrypoint (`play::server::start`, the exact
   function `lib.rs` setup calls) rather than the private `serve_loop` test
   helper every pre-existing route test in that file uses — binds a real
   ephemeral `127.0.0.1` port, then makes real HTTP requests over it and
   asserts on status codes and body content for `/player.html`, `/rom/<id>`,
   and `/healthz`. The pre-existing route-table tests (still present,
   unchanged) continue to cover the fuller path/edge-case matrix at the
   `handle_request` level; this new test is the "does the actual thing you'd
   run in production even bind and answer" proof above them.

2. **Native-path smoke** (`play/native/runtime.rs`,
   `mod headless_integration`). A synthetic stub libretro core — compiled at
   test time via `cc`, the exact convention `host.rs`'s `build_stub_core` and
   `core/core_options/probe.rs`'s `build_stub_core` already established (never
   a bundled/copyrighted ROM) — that deterministically emits a non-uniform,
   non-zero 4×4 RGB565 frame and a non-silent interleaved-stereo audio batch
   on every `retro_run` tick. Two tests:
   - `a_real_run_frame_tick_produces_genuine_video_and_audio_content` drives
     the raw FFI lifecycle directly (`LibretroCore::load` →
     `set_environment` → `init` → wire callbacks → `load_game` →
     `run_frame`) and asserts the real `callbacks::CallbackChannels` receives
     genuinely varying, non-blank video bytes and genuinely non-silent audio
     samples — hardware-independent (no `cpal`/audio-device dependency), so
     fully deterministic in headless CI.
   - `native_runtime_start_produces_polling_real_frames` drives the actual
     public `NativeRuntime::start` entrypoint end-to-end (the same
     constructor `commands::native_play::start_native_play` calls in
     production) and polls `latest_frame()` until a real, non-blank RGBA8888
     frame lands, then asserts the sequence number keeps advancing on a
     second poll — proving continuous production, not a single static frame.

3. **Play-adjacent IPC command-surface contract tests**, one file per command
   module, each following this crate's pre-existing convention (test the
   real function/domain logic a `#[tauri::command]` thinly wraps, since
   `tauri::State<'_, T>` has no public test constructor — confirmed against
   the vendored `tauri` 2.11 source; every existing command module in this
   crate, e.g. `commands::cores`, already avoids constructing `State` in
   tests for the same reason):
   - **Native frame polling** (`commands/native_play.rs`,
     `start_poll_stop_contract_produces_and_then_stops_real_frame_delivery`):
     a second, frame-producing stub core drives the literal body sequence of
     `start_native_play` → `get_native_frame` → `stop_native_play` against a
     plain `NativeSession`, asserting an empty poll before start, a real
     non-empty framed response with correct header/dimensions/non-blank
     pixels while running, and an empty poll again after stop.
   - **CRT config get/set** (`commands/crt_filter.rs`, `ipc_contract`-style
     tests reproducing `get_crt_filter`/`set_crt_filter`'s exact bodies
     against an isolated `Paths::with_root`): fresh-install default,
     set-then-get round trip, out-of-range clamping, and preset persistence —
     all through a real `AppConfig::load`/`save` file round trip, not just
     the in-memory DTO conversion the pre-existing tests covered.
   - **Perf-log read** (`commands/perf_tools.rs`): reproduces
     `read_native_perf_log`/`read_ejs_perf_log`/`report_ejs_perf_stats`'s
     exact bodies against an isolated `Paths::with_root` — a fresh install
     reads back empty (not an error), a reported EJS stat round-trips through
     a real file read, the two logs are genuinely separate files, and a line
     shaped exactly like `play::native::runtime`'s own `[rgp-native]` output
     is read back correctly by the same resolved path the native runtime
     writes to.
   - **Core-options get/set/list** (`commands/core_options.rs`,
     `mod ipc_contract`): a real stub core (declaring one option via
     `RETRO_ENVIRONMENT_SET_VARIABLES`) probed through
     `core_options::probe_declared_options` and resolved through
     `resolve_session_variables`/`get_persisted_value`/`set_persisted_value`
     against a real `Db::open_in_memory()` — covers the unset-falls-back-to-
     core-default path, the persisted-value-wins-on-a-second-probe path, and
     the exact `CoreOptionDto` mapping `list_core_options` serializes to the
     frontend.

**Regression-catching spot-check (proving these aren't decorative).**
`play::native::runtime`'s `drain_video` stamps a new sequence number every
time a frame is converted into the shared slot — the exact signal the
frontend's poller (and `get_native_frame`) relies on to know "a new frame
arrived." The line `slot.seq = slot.seq.wrapping_add(1);` was temporarily
commented out (simulating a realistic regression: the poller would then
believe no new frame ever arrived, even though frames were still being
produced) and `cargo test` re-run: both
`native_runtime_start_produces_polling_real_frames` (asserts the sequence
number advances across two polls) and `start_poll_stop_contract_produces_and
_then_stops_real_frame_delivery` (asserts `seq >= 1` on the first polled
frame) failed immediately with clear assertion messages naming the stalled
sequence number. The line was then restored and the full suite re-verified
green. This is the acceptance criterion "a broken player fails CI, not manual
QA" demonstrated directly, not merely asserted.

**Wiring into `recipe.py smoke`.** Not needed: `.claude/recipes.json`'s `test`
target already runs `cargo test --manifest-path src-tauri/Cargo.toml`, and the
new coverage above is ordinary `#[cfg(test)]` code in the same crate — no new
feature flag, binary, or separate invocation. It runs automatically every time
`recipe.py test` (and therefore every gate sequence in `CLAUDE.md`) runs. The
`smoke` target's own scope (served-UI-surface verification via
`scripts/visual-inspect.mjs`) is deliberately unchanged — play-path/IPC
integration coverage lives in `test`, not `smoke`, matching where each kind of
verification already belonged before this work.

**What's still not covered (recorded, not hidden).** The external-RetroArch
launch path (`emulation-launch-design.md`) has no integration coverage here —
it shells out to an external process Harmony doesn't control, which is a
materially different (and already separately scoped) verification problem
from the two paths Harmony hosts directly; out of scope for #28's proposed
scope, which named only the loopback server and the native host. Real audio
*hardware* output (a live `cpal`/CoreAudio device stream) remains unverified
in CI by construction — the native-path audio assertions above stop at "the
core produced real, non-silent samples," which is the correct, deterministic
boundary for CI; a real device stream is exactly the `#[ignore]`d
`manual_play_produces_audible_output` harness's job (unchanged by this work).
