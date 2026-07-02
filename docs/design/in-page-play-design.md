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
