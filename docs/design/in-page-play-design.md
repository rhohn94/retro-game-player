# In-page play — embedded WASM emulator, in-game overlay, seamless transitions (v0.15 "Live play")

> **Up:** [↑ Design docs](README.md)

Harmony plays supported games **inside the app** — the game auto-boots in a
player at the top of the detail screen, with sound, as part of the retro "vibe".
This is the embedded-WASM path (EmulatorJS); the native external-RetroArch launch
([emulation-launch-design.md](emulation-launch-design.md)) stays for systems
without a bundled in-page core. Pivoted from the originally-planned "managed
RetroArch" approach because macOS gives an external RetroArch sole ownership of
its window + input — Harmony can't own the surface and overlay simultaneously.

## 1. Loopback-origin architecture (#8)

In a production Tauri build the webview runs on the `tauri://localhost` custom
scheme. EmulatorJS's core pipeline — fetch a 7z core, decompress it in a
blob-URL **Web Worker**, then `WebAssembly`-instantiate — silently fails there
(`EJS_Runtime is not defined`): the custom scheme is not a normal web origin, so
blob Workers / WASM misbehave. (Dev mode hides this — `tauri dev` serves the
webview from `http://localhost:1420`, where it works; the bug is build-only.)

Fix: serve everything the emulator needs from a real **`http://127.0.0.1`
loopback origin** and embed it in an `<iframe>`. The emulator then runs in a
normal web origin where Workers/WASM/blobs work.

- **`src-tauri/src/play/server.rs`** — a `tiny_http` server bound to
  `127.0.0.1:0` (ephemeral port, like the Fleet server). Routes:
  - `GET /player.html` — the host page (embedded via `include_str!`).
  - `GET /emulatorjs/<path>` — the EmulatorJS runtime, embedded into the binary
    with `include_dir!` from `src-tauri/vendor/emulatorjs` (served immutable-cache).
  - `GET /rom/<id>` — ROM bytes, resolved by id through the server's **own
    read-only SQLite connection** (`SELECT path FROM games WHERE id=?`), so it
    never contends for Tauri's managed `Db`.
  - `HEAD` → empty 200; `GET /healthz` → `ok`.
  Started best-effort in `lib.rs` setup; the origin is exposed to the frontend
  via the `get_play_origin` IPC command (empty string ⇒ unavailable ⇒ native
  launch fallback).
- **`src-tauri/vendor/player.html`** — sets `EJS_pathtodata=/emulatorjs/`,
  `EJS_gameUrl=/rom/<id>` (the game download is `notWithPath`, so the relative
  URL hits the loopback origin), `EJS_startOnLoaded=true` (auto-boot), and bridges
  the overlay (§4).
- **`src/features/play/InPagePlayer.tsx`** — renders the iframe; teardown is just
  unmounting it (disposes emulator + audio + workers).
- **`src-tauri/Info.plist`** — `NSAppTransportSecurity › NSAllowsLocalNetworking`
  so WKWebView permits the `http://127.0.0.1` iframe from the `tauri://` page;
  `csp:null` already allows the frame. Single-thread NES core ⇒ no
  SharedArrayBuffer ⇒ **no COOP/COEP** required.

## 2. Load speed (offline + fast first boot)

All assets are loopback-served; the boot is fully offline. Three levers:

1. **Single minified bundle.** `player.html` loads one `emulator.min.js` (built
   locally from `src/` by `scripts/build-ejs-bundle.mjs` via terser — output is
   byte-identical to the upstream CDN bundle) instead of 8 sequential `src/*.js`
   loads.
2. **★ Local WebGL2 core (the core-variant gotcha).** EmulatorJS DEFAULTS fceumm
   to the `-legacy` (WebGL1) core, i.e. it requests `fceumm-legacy-wasm.data`. We
   bundle the non-legacy `fceumm-wasm.data`, so the default path 404'd locally and
   **silently downloaded the 1 MB core from the public CDN on every boot** (slow +
   broke offline). `player.html` sets `EJS_defaultOptions={webgl2Enabled:"enabled"}`
   so EmulatorJS requests the non-legacy core we bundle; WKWebView supports WebGL2.
   **Adding cores: bundle the non-legacy `<core>-wasm.data` and keep webgl2 forced.**
3. **Immutable cache headers** on `/emulatorjs/*` so the webview reuses the bundle
   + core across in-session game switches.

Residual cost (not config-tunable): EmulatorJS re-runs 7z-decompress + WASM-compile
every boot (it caches only the *compressed* bytes). Researched in the latency
spike (warm-emulator swap + decompressed-core cache).

## 3. In-game overlay + immersive mode (#6)

While the player is mounted it **owns the controller** via a new controller-context
primitive, `setExclusiveHandler` ([ControllerProvider](../../src/features/controller/ControllerProvider.tsx)):
when set, every semantic action routes to it and bypasses spatial nav. So the
gamepad belongs to the game; the menu/Start button, controller back, or **Escape**
summon a Harmony overlay (Resume / Full screen / Exit).

- **Input ownership.** The gamepad feeds both Harmony (parent poll) and EmulatorJS
  (iframe poll). To avoid double-driving, opening the overlay **pauses** the
  emulator via `postMessage` (`player.html` calls `EJS_emulator.pause()/.play()`).
  The overlay then traps controller nav; the paused game ignores input.
- **Escape bridge.** When the game iframe holds keyboard focus the parent never
  sees Escape, so `player.html` forwards it up as a `postMessage` the parent
  validates by `event.origin`.
- **Immersive mode, not element-fullscreen.** "Full screen" is a Harmony immersive
  mode — the player `position:fixed` fills the viewport over the chrome + the Tauri
  window goes fullscreen — *not* `iframe.requestFullscreen()`. A parent overlay
  cannot render over an element-fullscreen iframe; immersive keeps the overlay on
  top. EmulatorJS keeps its own in-frame settings (save states, controls, volume).

## 4. Seamless transitions (#7)

- The player frame fades in as the game boots (`harmony-player-in` keyframe, gated
  by the global reduced-motion rule).
- The overlay scrim + panel animate in/out via `AnimatePresence` using the shared
  motion presets (`DUR.fast`, `dialogPop`) — no raw duration literals (motion
  single-source guard).

## 5. Licensing

EmulatorJS is **GPL-3.0**. The vendored runtime + the NES core are bundled into
the app, so the distribution carries attribution for EmulatorJS. Harmony ships
**no game content** — `/rom/<id>` only serves files the user imported into their
own library.

**Done (release attribution):** the bundled components — EmulatorJS (GPL-3.0),
the fceumm NES core (GPL-2.0-or-later), nipplejs (MIT), and libunrar.js
(UnRAR license) — are documented in
[`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md) at the repo root, with
the verbatim GPL-3.0 text in [`licenses/GPL-3.0.txt`](../../licenses/GPL-3.0.txt)
and a written-offer pointer to corresponding source. The README links to the
notices. Two items are flagged there as open questions for the maintainer:
Harmony's own combined-work license (GPL copyleft over the single binary) and the
UnRAR license's GPL-incompatibility.

## 6. Degradation surfacing (v0.23, W234)

The play stack degrades in three places, all silent today: the loopback server
fails to bind (stderr only — in-page play quietly becomes an external RetroArch
launch), native init fails (quietly becomes EmulatorJS via `PlaySwitch`'s
`onStartFailed`), and the no-path case (no bundled in-page core + no RetroArch
found) leaves a Play button that appears to do nothing. v0.23 makes each
visible without being noisy:

- **Structured reason, one place.** The play-path decision points return a
  `degradation: { from, to, reason } | null` field on their existing IPC
  responses (`get_play_origin` grows a reason for the empty-string case;
  `start_native_play` failure carries its error through `PlaySwitch`). The
  frontend logs every degradation through one helper.
- **Detail-page notice.** A dismissible, non-blocking notice (shared
  `ErrorNotice`-family styling, info tone) renders above the player slot:
  *what failed → what Harmony is doing instead → where to fix it* (deep-link
  to Settings → Playback / RetroArch pane). Shown once per session per cause.
- **No-path error state.** When neither an in-page core nor RetroArch can run
  the title, the player slot renders a real empty/error state (unified W226
  primitives) naming both missing pieces, instead of a dead Play action.
- **Normal operation renders nothing new.**

## Verification

- `pnpm test` — motion single-source, token-adoption, mock-IPC guards stay green;
  `cargo test play::` — loopback routing + embedded-asset presence.
- Real-app smoke: open a NES title → game auto-boots with sound; the request log
  (`HARMONY_PLAY_LOG=1`) shows all assets loopback-served, `fceumm-wasm.data`
  local, **zero** legacy/CDN fetches, one minified bundle.
- Overlay: Esc / ☰ / controller menu opens Resume·Full screen·Exit; game pauses;
  Full screen enters immersive (window fullscreen + fill); Exit returns to library.

## 7. Multi-core coverage (v0.24, W241 — #17)

v0.15 shipped exactly one in-page core (NES `fceumm`, embedded in the binary
and served from the loopback origin). W241 extends in-page play to the rest
of the high-value catalog **without growing the DMG**: every additional core
is fetched on demand, verified, cached on disk, and served from the same
loopback origin.

### Curated core catalog (Rust, `play/ejs_cores.rs`)

A static table mirroring `core/cores/system_map.rs`'s philosophy — one place,
no magic strings. Each entry: EmulatorJS core name (passed as `?core=` /
`EJS_core`), the Harmony system keys it covers, the CDN archive + report
filenames, **pinned SHA-256 hashes** (curated 2026-07-01 against the
version-pinned CDN), size, and license. Pinned source:
`https://cdn.emulatorjs.org/4.2.3/data/cores/…` — the same EmulatorJS version
as the vendored runtime (`version.json`), so runtime/core compatibility is
frozen together and a vendored-EJS bump forces re-curation by construction.

| EJS core | Harmony systems | ~Size | License |
|---|---|---|---|
| `snes9x` | snes | 1.1 MB | Snes9x (non-commercial) |
| `genesis_plus_gx` | genesis, mastersystem | 1.2 MB | Genesis-Plus-GX (non-commercial) |
| `mupen64plus_next` | n64 | 1.5 MB | GPL-3.0 |
| `pcsx_rearmed` | ps1 | 1.0 MB | GPL-2.0 |
| `stella2014` | atari2600 | 1.1 MB | GPL-2.0 |
| `mednafen_pce` | pcengine | 1.0 MB | GPL-2.0 |
| `gambatte` | gb, gbc | 0.9 MB | GPLv2+ |
| `mgba` | gba | 1.0 MB | MPL-2.0 |

NES stays embedded (`fceumm`, unchanged). All eight cores are single-threaded
(EmulatorJS `requiresThreads` lists only `ppsspp`/`dosbox_pure`), so the
loopback server still needs **no COOP/COEP headers** and no
`SharedArrayBuffer`.

> **v0.34 (W341) note:** `gambatte`/`mgba` were added and SHA-256-pinned
> 2026-07-05 against the same version-pinned CDN, extending in-page fallback to
> the new handheld systems (Game Boy / Color / Advance — see
> `console-catalog-design.md` §7). **Wii is deliberately excluded** — Dolphin
> has no browser/WASM build, so Wii stays external-RetroArch-launch only; there
> is no "get core" panel path for it.

### Acquisition + serving

- `install` command: streaming GET of archive + report (version-pinned URLs,
  https-only), 8 MiB cap, SHA-256 verified against the pinned catalog hash
  **before** the atomic write into
  `app-support/ejs-cores/<ejs-version>/{<core>-wasm.data, reports/<core>.json}`.
  A hash mismatch deletes the temp file and errors — never a partial cache.
- The play server's `/emulatorjs/cores/<path>` lookup checks the disk cache
  first, then the embedded bundle — the EmulatorJS loader is completely
  unaware which tier served it. Path traversal is rejected before any disk
  read.
- Cache keyed by EJS version: a future runtime bump naturally starts a fresh
  dir and re-downloads matching cores.

### UI flow

`PlaySwitch` now resolves three in-page outcomes per system:
1. **Ready** (bundled or cached core) → `InPagePlayer` boots exactly as NES
   does today (same overlay/immersive/save-bridge behavior — all of it is
   core-agnostic already).
2. **Available but not installed** → the player slot renders a "get core"
   panel: one button naming the core and size ("Get SNES core · 1.1 MB"),
   inline progress, then boots in place on success. RetroArch fallback text
   sits alongside — never a dead end.
3. **No in-page core** → unchanged (external RetroArch launch only).

### Known limits (recorded, not hidden)

- **PS1**: `pcsx_rearmed` runs HLE BIOS — many titles boot without a real
  BIOS file, some don't; multi-file images (`.cue`+`.bin`) can't be served
  through single-file `/rom/<id>` — single-file formats (`.chd`, `.pbp`,
  single `.bin`) only. Both surfaced in the get-core panel copy.
- **Licenses**: snes9x and genesis_plus_gx are non-commercial-licensed; they
  are **not distributed with Harmony** — fetched at explicit user request
  from the EmulatorJS CDN, mirroring the RetroArch core-downloader model.
  Recorded in THIRD-PARTY-NOTICES.md.

### Player-2 config (v0.35, W353)

v0.35 ("Player Two") adds two-controller multiplayer. The **native** libretro
host (`emulation-launch-design.md`, `native-emulation-design.md` §Multiplayer
input) is the primary multiplayer surface; this note covers what the
**EmulatorJS fallback tier** does, verified by reading the actual vendored
runtime (`src-tauri/vendor/emulatorjs/src/{emulator,gamepad}.js`, EJS 4.2.3) —
not assumed from upstream docs.

**EmulatorJS's built-in assignment behavior:**
- `GamepadHandler` (`src/gamepad.js`) has no player-index concept at all — it
  just reports `gamepadIndex` (the raw `Gamepad.index` from the browser) on
  connect/disconnect/button/axis events.
- `EmulatorJS.gamepad.on("connected", …)` (`src/emulator.js`) is where
  player-slot assignment actually happens: on each `connected` event it walks
  `this.gamepadSelection` (one entry per player, 0–3) and drops the new pad's
  id into the **first empty slot**. In practice this means: first pad
  connected → player 0, second pad connected → player 1, automatically, with
  no configuration and no in-iframe manual mapping. **This part already works
  in our embed with zero changes.**
- What does **not** work out of the box: `this.defaultControllers` (seeded in
  `initControlVars()`) hard-codes a full keyboard+gamepad button map for
  player **0** only — `defaultControllers[1]`, `[2]`, `[3]` are `{}` (empty)
  in the vendored 4.2.3 build. `gamepadEvent()` looks up
  `this.controls[player][buttonIndex].value2` to route a press to
  `GameManager.simulateInput(player, index, value)`; with an empty control map
  for player 1, a second pad is correctly *selected* into slot 1 but every
  button press is silently dropped before it ever reaches the core. Unassisted,
  player 2 would appear to have a "connected" controller that does nothing.

**Our configuration:** `src-tauri/vendor/player.html`'s inline boot script now
sets `EJS_defaultControls` (the documented `config.defaultControllers`
override point) with a standard-gamepad-mapping button table
(A/B/X/Y·Select/Start·shoulders·d-pad — the only buttons NES/SNES cores read)
for **both** player 0 and player 1. This is a wholesale replacement, not a
merge (`emulator.js` only does `this.defaultControllers = this.config.defaultControllers`
when the config key is truthy), so player 0's entry repeats EmulatorJS's own
built-in keyboard mapping to avoid silently breaking keyboard play the moment
the override is present; player 1 is gamepad-only (a second physical pad is
the only supported player-2 input on this tier — keyboard-as-player-2 is out
of scope). Covered by
`src-tauri/src/play/server.rs::tests::serves_player_html_and_runtime_and_rom_and_404`,
which asserts the served page carries populated control maps for both player
slots (not just that the `EJS_defaultControls` key exists).

**What remains a human on-device follow-up:** headless testing can verify the
served config (the assertion above) but not that two physical pads plugged
into a real machine actually drive players 1 and 2 independently in a running
NES/SNES session — that two-pad behavioral check is a manual follow-up
alongside the native path's on-device check (see release notes / QA pass for
v0.35).

## 8. Player conveniences (v0.24, W243 — #22)

- **Volume + mute, both paths, persisted.** `AppConfig` gains
  `player_volume` (default 1.0) and the overlay gains a mouse-driven slider
  row plus a keyboard/controller "Mute" item (`usePlayerPrefs`, debounced
  persist). The native path applies it as the `AudioRing` gain
  (`set_native_volume`, multiplied with the W235 attract duck); the
  EmulatorJS path streams it over the bridge (`harmony-volume` →
  `EJS_emulator.setVolume`), with a pre-start value held until the "start"
  event.
- **Rewind / fast-forward (EmulatorJS only).** `player.html` boots with
  `rewindEnabled` and the overlay adds "⏪ Rewind 5 s" (`harmony-rewind` →
  `toggleRewind(1)`, timed `toggleRewind(0)`) and a fast-forward toggle
  (`harmony-fastforward` → `toggleFastForward`). The native path hides both
  — rewind needs frame-history machinery only EmulatorJS carries today
  (see release plan §4).
- **Pause on window blur, both paths, default on.** `AppConfig.pause_on_blur`
  (Settings → Playback toggle). Window `blur` freezes the game
  (`set_native_paused` / `harmony-pause`) unless the overlay already owns
  the pause; `focus` resumes only what blur paused.

## 9. Warm-then-reset audio warmup (v0.27.1, W276)

**The defect.** A fresh `AudioContext` produces ~2–3 s of garbled samples on
every EmulatorJS boot while the WASM JIT warms, the core finishes init, and
RetroArch's resampler converges. v0.21 "Bedrock" fixed this at the root for
NES by hosting it natively, but the EJS path remains the primary in-page
player for the 7 v0.24 systems (SNES, Genesis, Master System, N64, PS1,
Atari 2600, PC Engine) and the automatic NES fallback — so every EJS boot
still garbled.

**Three historical approaches** (`fix/audio-warmup`, 2026-06-29), forward-
ported here from the final commit (`2ecf102`) — the branch predates the v0.23
save bridge and W243 volume/rewind bridge, so this was a re-port, not a merge:

1. *Master-gain fade-in* (`1379ac4`) — rejected: a fade long enough to mask
   the garble swallows the boot jingle, violating the boot-with-sound retro
   vibe (a hard product requirement — never a muted or vibe-less boot).
2. *Larger audio buffer / `latencyHint`* (`14710e4`) — rejected: the samples
   themselves are wrong during cold-start; buffering them differently just
   plays the same garble later.
3. ***Warm-then-reset*** (`2ecf102`, shipped here) — boot once muted and
   covered to pay the cold-start cost, then reset the emulator and reveal:
   the boot the user sees and hears replays clean from power-on, preserving
   the boot screen + jingle.

**Shim contract** (`player.html`, its own `<script>` before the boot script).
Wraps `AudioContext`/`webkitAudioContext`; every wrapped context gets a
per-context master `GainNode` (`ctx.__harmonyMaster`) spliced in by rerouting
`connect(ctx.destination)` through it (`disconnect` handled symmetrically).
The master starts at gain 0 (or 1 for contexts created after reveal).
`window.__harmonyRevealAudio()` fades all masters up with a 0.25 s
exponential ramp. Every wrapper is defensive: any failure leaves native
audio untouched.

**Orchestration contract** (main IIFE, after the loader append). A black
`#warmup-cover` div ("Warming up…", also the DOM marker for the smoke
inspect) covers the frame. `WARMUP_MS = 3000` is timed from the emulator's
one-shot `start` event (fallback: instance-appearance polling if `.on` is
absent); then `gameManager.restart()` (fallback `em.restart()`), then reveal
(fade audio up + fade the cover out). If the reset throws, reveal anyway.
`MAX_WAIT_MS = 25000` is an unconditional reveal safety net — the page can
never stay muted/covered forever; a reset deferred past it becomes a no-op
(never reset a game the user can already see).

**Interaction seams (new since the historical branch):**

- **Save bridge (v0.23 W231):** the post-reset boot re-fires `start`, so the
  save-bridge wiring (`restoreSram` + SRAM flush interval + pending-volume
  apply) carries a one-shot `wired` guard, exactly like the warmup's own
  `start` listener. SRAM restored before the reset survives it — a reset
  preserves the core's SRAM region (that is what battery saves are).
- **Pause (v0.15 overlay / W243 pause-on-blur):** the message bridge tracks
  `paused` from `harmony-pause`/`harmony-resume`; a warm timer firing while
  paused defers the reset+reveal to the next resume, so the reveal never
  presents a paused, still-garbled frame. (The `MAX_WAIT_MS` net still
  reveals unconditionally.)
- **Volume (W243):** no change needed — verified by reading the flow:
  `EJS_emulator.setVolume` writes the per-source OpenAL gain nodes
  (`Module.AL.currentCtx.sources[].gain`), which sit upstream of the terminal
  `connect(ctx.destination)` the shim reroutes. The two gains are in series
  and multiply, so they compose: muted warmup wins regardless of user volume
  (0 × v = 0), and after reveal the user volume applies unchanged.

**Accepted cost:** every EJS boot takes ~3 s longer, spent behind the
"Warming up…" cover. Recorded refinement (release plan §4): adaptively
shortening the window by measuring the garble, if 3 s proves annoying.

**Coverage:** no JS test rig exists for `player.html`; the automated coverage
is the `server.rs` route test asserting the served page contains
`__harmonyMaster`, plus the runtime smoke. The logic is kept defensively
simple for that reason.
