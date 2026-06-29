# Release Planning — v0.15

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.15.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.15` |
| **Previous** | `v0.14` (Lounge — controller nav, fullscreen, console specs) |
| **Theme** | "Arcade" — play, live and in-page: a supported game boots inside the Harmony detail screen, with sound, as part of the retro vibe. Second of three grouped releases in the 8-feature program. |

Closes program items #6 (in-game overlay + immersive mode), #7 (seamless
transitions), and #8 (in-page play). Design:
[`in-page-play-design.md`](design/in-page-play-design.md).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W151** | In-page play (#8) | A supported game (NES) auto-boots in an embedded EmulatorJS WASM core on entry to the detail screen, with sound. The emulator runs in an `<iframe>` on a loopback `http://127.0.0.1` origin (a tiny `tiny_http` server serving the `include_dir!`-embedded runtime + the ROM resolved by id from a read-only SQLite connection), because EmulatorJS's Worker/WASM pipeline fails under the `tauri://` scheme. Systems with no bundled in-page core fall back to the native external-RetroArch launch. Offline: the non-legacy WebGL2 core is forced and bundled, so zero CDN fetches. |
| **W152** | In-game overlay + immersive mode (#6) | While mounted the player owns the controller (`setExclusiveHandler`); the menu/Start button, controller back, or Escape open a Harmony overlay (Resume / Full screen / Exit) that pauses the emulator via `postMessage`. The in-iframe Escape is forwarded up (origin-validated). "Full screen" is a Harmony immersive mode (window fullscreen + `position:fixed` fill) so the overlay renders over the running game — not `iframe.requestFullscreen()`. |
| **W153** | Seamless transitions (#7) | The player frame fades in as the game boots (`harmony-player-in`, reduced-motion gated); the overlay scrim + panel animate in/out via `AnimatePresence` using the shared motion presets (`DUR.fast`, `dialogPop`) — no raw duration literals. |

---

## 3. Strategy

Single-feature in-session release. The pivot from the originally-planned "managed
RetroArch" approach is recorded in the design doc: macOS gives an external
RetroArch sole ownership of its window + input, so Harmony can't own the surface
and overlay simultaneously — the embedded-WASM (EmulatorJS) path replaces it,
while the native launch stays for systems without a bundled in-page core. The
loopback-origin server mirrors the existing Fleet status server (127.0.0.1,
ephemeral port, best-effort bind → native-launch fallback). Full gates before
merge; the live iframe boot is verified in the real built app (the mock-IPC smoke
harness returns an empty play origin, so `InPagePlayer` renders nothing there).

## 4. Out of scope

- Cores beyond NES — adding one means bundling its non-legacy `<core>-wasm.data`
  and keeping WebGL2 forced (documented in the design doc); BIOS-gated systems
  (psx/saturn/3do) stay on the native launch for now.
- Warm-emulator swap / decompressed-core cache — the residual per-boot
  7z-decompress + WASM-compile cost is researched but not yet optimized.
- In-app download results + per-provider toggle — that's v0.16 (Downloads).

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W151 — in-page play | feat/v0.15-live-play | ☑ | `play::server` (tiny_http + `include_dir!` EmulatorJS + ROM-by-id read-only SQLite); `get_play_origin` IPC; `InPagePlayer` iframe; `Info.plist` `NSAllowsLocalNetworking`; vendored `fceumm-wasm` core; `ejs.ts` own-property gate (tested). |
| W152 — overlay + immersive | feat/v0.15-live-play | ☑ | `setExclusiveHandler` controller ownership; Esc/☰/menu overlay; `postMessage` pause/resume; origin-validated Escape bridge; window-fullscreen immersive mode. |
| W153 — seamless transitions | feat/v0.15-live-play | ☑ | `harmony-player-in` fade (reduced-motion gated); overlay `AnimatePresence` with `DUR.fast` / `dialogPop`. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| feat/v0.15-live-play → dev | ☑ | merged `--no-ff`; gates green (typecheck, cargo check, lint, clippy, 70 vitest + 3 cargo play tests, recipe.py smoke) |
| dev → main promoted + tagged v0.15 | ☑ | |
| pushed to origin | ☑ | main + dev + tag v0.15 (fast-forward, no force) |
