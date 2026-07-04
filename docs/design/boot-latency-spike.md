# Boot-latency spike — findings (#14, v0.24 W242)

> **Up:** [↑ Design docs](README.md)
>
> Research-only deliverable: two techniques investigated to cut the ~1–2 s
> in-page (EmulatorJS) boot floor. No production code changes in this item.
> Source basis: vendored EmulatorJS **4.2.3** — `src/emulator.js` (6,164
> lines), `src/GameManager.js`, `src/compression.js`; Harmony's
> `vendor/player.html` and `InPagePlayer.tsx`. Line references are into the
> vendored (readable) `src/emulator.js`.

## Where the boot time actually goes

The cold-boot call chain per game is: constructor → `downloadGameCore()`
(emulator.js:524–637) → decompress via a 7z/zip Worker
(`checkCompression`, :495–505; `compression.js:110–138`) →
`initGameCore(js, wasm, thread)` (:639) → `initModule()` (:933–979,
Emscripten runtime + `WebAssembly` compile behind blob URLs) →
`downloadFiles()` (:916) → `downloadRom()` (:777–914, `FS.writeFile` at
:790/:822–826) → `startGame()` (:981, `Module.callMain` + `resumeMainLoop`).

Harmony already eliminated the network from this chain (v0.15: the runtime +
core are embedded in the binary and served from the loopback origin), so the
remaining floor is dominated by two CPU-bound steps that run **every** boot:

1. **Core decompression** — EmulatorJS caches only the *compressed* core
   archive in IndexedDB (`EmulatorJS-core`, keyed by filename, versioned by
   `buildStart` from `cores/reports/<core>.json`; :575/:584/:605–636) and
   re-runs the 7z Worker each time.
2. **WASM compilation** — `EJS_Runtime` (minified Emscripten glue)
   re-instantiates the module from bytes each boot; nothing is reused.

ROM fetch/write is loopback + small; it is not the floor.

## Technique A — preloaded "warm" emulator + ROM swap

**Feasibility: NOT feasible as a live-instance swap; NO-GO.**

- **No swap API exists.** EmulatorJS exposes no `swapRom()`/`reloadGame()`;
  the ROM enters exactly once, inside `downloadRom()` via
  `gameManager.FS.writeFile()` (:790, :822–826), and the game starts via
  `Module.callMain(["-v", "/<file>"])` (:987). A swap would mean hand-calling
  `FS.writeFile` + `GameManager.restart()` (a soft in-core reset, not a
  reload) + `callMain` again — an unsupported path through a patched vendored
  internal.
- **State leaks across games on one instance.** The Emscripten FS, the WASM
  heap (old ROM data, save buffers), and the AudioContext all persist across
  a hypothetical swap; RetroArch-side `system_restart` does not reinitialize
  the loaded content. Correctness risk is high and per-core.
- **The killer: the trusted-gesture audio gate.** A pre-warmed hidden iframe
  boots with a synthetic click, so WKWebView keeps the AudioContext
  **suspended** (checkStarted polling, :1044–1069 — the exact gate Harmony's
  W233 vendored patch surfaces). No postMessage can grant a trusted gesture
  later. Harmony's product requirement is *auto-boot with sound* on
  detail-page entry (the retro "vibe"; a click-to-resume gate is explicitly a
  bug) — a warm instance would boot silent, which is the one failure mode
  this project has already rejected four mitigations over (#15).
- **The weak variant gains nothing here.** "Warm the cache on tile hover"
  only prefetches the compressed core into IndexedDB — but Harmony's cores
  are served from the embedded binary over loopback, so fetch is already
  ~free. The costs that matter (decompress + compile) happen after the real
  boot click regardless.

**Estimated saving if forced through anyway:** most of the 1–2 s floor — but
at the cost of silent-audio boots and unsupported per-core state resets.
**Recommendation: no-go.** Native hosting (v0.21/W240, now default-on for
NES) is the sanctioned answer to instant boot, and broadening *native* core
coverage is the better long-term lever (roadmap Backlog).

## Technique B — decompressed-core caching

**Feasibility: feasible, small and well-bounded; GO (with the
compiled-module half explicitly dropped).**

- **Patch point is a single seam.** Store the decompressed artifacts
  (`.js`, `.wasm`, `.worker.js`) in IndexedDB right where `gotCore`
  produces them (:540–573, before `initGameCore` at :572), keyed
  `"<filename>#decompressed"` and versioned by the same `rep.buildStart`
  the compressed cache already uses; short-circuit at the existing cache
  check (:604–610) when a version-matching decompressed entry exists. This
  skips the 7z Worker entirely on repeat boots.
- **Compiled `WebAssembly.Module` caching is a dead end on WKWebView.**
  Persisting a compiled `Module` to IndexedDB via structured clone is not
  supported by WebKit (and was removed from Chromium); there is no portable
  compiled-code cache accessible to page JS. WKWebView applies its own
  internal bytecode/wasm caching opportunistically, but it is not
  controllable. So compilation stays per-boot; only decompression is
  eliminated.
- **Alternative implementation worth weighing in the follow-up:** with W241
  (on-demand core acquisition) Harmony's Rust side gains a disk cache of
  core archives — the loopback server could decompress **once at
  install-time** and serve raw `.wasm`/`.js` files, moving the whole cost
  out of the page and out of the vendored patch. Same saving, smaller JS
  diff, but requires teaching the loader to accept pre-extracted files.
  The follow-up ticket should pick between the two.
- **Maintainability:** either variant patches or bypasses vendored upstream
  behavior; precedent exists (the W233 start-gate patch), and the
  re-apply-on-EJS-bump cost is documented in THIRD-PARTY-NOTICES territory.
  Bounded, but a real recurring cost.

**Estimated saving:** the decompress step scales with core size (fceumm's
archive is ~1.2 MB; snes9x ~1.1 MB; mupen64plus/pcsx are several MB) —
roughly a few hundred ms per boot on this hardware class, more for the
heavier cores W241 introduces. Compile remains, so the floor drops but does
not vanish. **Recommendation: go** — scoped follow-up filed as a v0.25+
candidate, to be implemented alongside/after W241 so the
serve-pre-extracted variant can be evaluated with real multi-core data.

## Outcome summary

| Technique | Verdict | Why |
|---|---|---|
| A. Warm emulator + ROM swap | **No-go** | No swap API; state leakage; hidden-iframe boots are silent (trusted-gesture gate) — conflicts with the auto-boot-with-sound requirement. Native hosting is the sanctioned instant-boot lever. |
| B. Decompressed-core caching | **Go** (decompress half only) | Single-seam patch or Rust-side pre-extraction; saves the per-boot 7z Worker. Compiled-Module caching is unsupported on WKWebView — dropped. |

Follow-up ticket: [#31](https://github.com/rhohn94/retro-game-player/issues/31)
(decompressed-core caching, page-patch vs. serve-pre-extracted decision).
