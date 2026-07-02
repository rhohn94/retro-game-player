# Release Planning — v0.24

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.24.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.24` |
| **Previous** | v0.23.1 (Continuity + frame-IPC hotfix) |
| **Theme** | "Everywhere" — every game plays *inside* Harmony, and it starts fast: in-page cores beyond NES, the boot-latency spike, player conveniences, and the user-requested direct-download loop. |

---

## 2. Major Features

### W240 — Native-play default ON

Flip `AppConfig::native_play_enabled`'s default to `true` — the v0.23 ledger
follow-up, now unblocked: the maintainer confirmed by ear (2026-07-01) that
native NES audio is clean and (post-W239) gameplay is smooth. EmulatorJS
fallback and the Settings toggle are unchanged; users who explicitly turned
it off stay off (the persisted value wins).

- **Acceptance:** a fresh config plays NES natively; existing saved configs
  keep their persisted value; default/round-trip tests updated;
  `native-emulation-design.md` flag decision updated.
- **Branch:** `feat/w240-native-default-on`
- **Design:** `native-emulation-design.md` (flag decision note).

### W241 — In-page cores for the catalog (#17)

Extend in-page EmulatorJS play beyond the single bundled NES core: a
per-system EJS core map, on-demand core acquisition (download once, cache
under app-support, serve from the loopback origin — never bundled into the
DMG beyond what already ships), and the runtime switch resolving each
system to its core with the external-RetroArch fallback intact for anything
uncovered. Target systems: SNES, Genesis/Master System, N64, PS1,
Atari 2600, GB/GBC/GBA.

- **Acceptance:** at least SNES, Genesis, N64, PS1, and Atari 2600 titles
  boot in-page with sound and the same overlay/immersive behavior as NES;
  a system without a cached core shows a clear "get core" affordance and
  falls back to RetroArch unchanged; THIRD-PARTY-NOTICES.md covers each
  added core; core files hash-verified on download.
- **Branch:** `feat/w241-inpage-cores`
- **Design:** `in-page-play-design.md` §Multi-core coverage (extend before
  implementation).

### W242 — Boot-latency spike (#14, research-only)

Time-boxed findings write-up on two techniques to cut the ~1–2 s in-page
boot floor: (A) preloaded warm emulator + ROM swap; (B) decompressed-core /
compiled-`WebAssembly.Module` caching. Feasibility, approach sketch, risks,
estimated saving, go/no-go per technique. No production code changes.

- **Acceptance:** `docs/design/boot-latency-spike.md` with both findings
  notes and per-technique recommendations; any "go" identifies a scoped
  follow-up ticket.
- **Branch:** `feat/w242-boot-latency-spike`
- **Design:** the spike doc *is* the deliverable.

### W243 — Player conveniences (#22)

Rewind and fast-forward on the EmulatorJS path (its built-ins, surfaced in
the shared overlay), a volume slider + mute in the overlay persisted per
user (native path drives the existing `set_native_volume` gain; EJS drives
its volume API), and pause-on-window-blur (configurable, default on) on
both paths.

- **Acceptance:** overlay exposes rewind/FF on EJS (hidden on native);
  volume persists across sessions and applies on both paths; blur pauses
  and refocus resumes on both paths; the setting round-trips.
- **Branch:** `feat/w243-player-conveniences`
- **Design:** `save-persistence-design.md` untouched; extend
  `in-page-play-design.md` §Player conveniences.

### W244 — Direct download (#30)

Wire the v0.16 per-provider `direct_download` seam into the full loop:
user-clicked download → streaming GET with safeguards (provider gate,
http(s)-only, 256 MiB cap, staging + atomic rename, progress, cancel,
3-global/1-per-provider concurrency) → v0.12 import pipeline (bare ROM +
.zip; .rar excluded) → "✓ In library — Play". No seeded provider ships
enabled; `run_search` keeps its structurally-no-fetch guarantee.

- **Acceptance:** per `direct-download-design.md` — opted-in provider
  downloads land imported and playable in-app; re-download hash-dedupes;
  flag-off providers reject server-side; cap/timeout/bad-archive failures
  render in-row with a reason.
- **Branch:** `feat/w244-direct-download`
- **Design:** `direct-download-design.md` (written 2026-07-01, sufficient).

### W245 — Version bump + gates + release ritual

Bump to 0.24.0, full gate suite, tick ledger, roadmap update, archive into
`version-history.md`.

- **Acceptance:** all gates green on `version/0.24`; ledger complete.
- **Branch:** `feat/w245-release-ritual`
- **Design:** n/a.

---

## 3. Parallel Implementation Strategy

| Phase | Items | Rationale |
|---|---|---|
| **1** | W240, W242 | Disjoint and tiny/doc-only: the flag default (config) and the research spike (new doc). |
| **2** | W241 | The release centerpiece; owns `play/server.rs`, EJS system mapping, `PlaySwitch`/`InPagePlayer`. |
| **3** | W243 | Overlay/player surfaces after W241 settles them; touches `player.html`, overlay hooks, settings. |
| **4** | W244 | Independent subsystem (`core/search/download.rs` + import + Search UI) but serialized to keep review focus; only overlaps W241 in THIRD-PARTY notices. |
| **5** | W245 | Release closeout, alone. |

Conflict map: `play/server.rs` + `InPagePlayer.tsx`/`player.html`
(W241→W243 serial); `core/search/*` + `SearchPage` (W244 alone);
`config/mod.rs` (W240, plus W243's blur/volume settings — serialized by
phase order); docs (W242 alone; W245 ticks ledger).

---

## 4. Out of Scope for v0.24

- **Native (non-WASM) hosting beyond NES** — roadmap non-goal; Backlog.
- **Torrents / resume / download-queue manager** — roadmap non-goal for the
  direct-download loop.
- **Native-path rewind/fast-forward** — needs frame-history ring on the
  serialize seam; candidate for v0.25+ once profiled.
- **Boot-latency implementation work** — W242 is a spike; any "go" lands as
  a scoped ticket for a later release.
- **CRT/shader filters (#23)** — v0.28 per roadmap.
- **TV-UI epic (#8)** — v0.26/v0.27 per roadmap.

No open `Grimoire-Requirement` issues exist (checked this pass — tracker
returned zero).

---

## 5. Status Ledger

### Phase 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.24 |
|---|---|---|---|---|
| `feat/w240-native-default-on` (W240) | ☑ | ☑ | ☑ | ☑ |
| `feat/w242-boot-latency-spike` (W242) | ☑ | ☑ | ☑ | ☑ |

### Phase 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.24 |
|---|---|---|---|---|
| `feat/w241-inpage-cores` (W241) | ☑ | ☑ | ☑ | ☑ |

### Phase 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.24 |
|---|---|---|---|---|
| `feat/w243-player-conveniences` (W243) | ☑ | ☑ | ☑ | ☑ |

### Phase 4

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.24 |
|---|---|---|---|---|
| `feat/w244-direct-download` (W244) | ☑ | ☑ | ☑ | ☑ |

### Phase 5

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.24 |
|---|---|---|---|---|
| `feat/w245-release-ritual` (W245) | n/a | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- **W242 verdicts:** technique A (warm emulator + ROM swap) = no-go — no swap
  API in EmulatorJS 4.2.3, cross-game state leakage, and hidden-iframe boots
  are silent (WKWebView trusted-gesture gate) which violates
  auto-boot-with-sound. Technique B (decompressed-core caching) = go, filed
  as [#31](https://github.com/rhohn94/harmony/issues/31) for v0.25+ so the
  serve-pre-extracted variant can be weighed against W241's disk cache.
- **W242 drive-by:** docs/design/README.md was missing index rows for the
  v0.23 design docs (save-persistence, direct-download) — added.
- **W243 deferral of record:** native-path rewind/fast-forward stays out (needs
  a serialize-seam frame-history ring; §4) — the overlay hides both on native.
- **W244 scope notes:** multi-file images (`.cue`+`.bin`) can't stream through
  the single-file download → import path (single-file `.chd`/`.pbp` fine);
  `.rar` errors with a pointer to the dropped UnRAR support (#26).
- **W241 verification note:** the real-CDN install path was verified once
  in-session (`manual_install_verifies_and_caches_a_real_core`, `--ignored`);
  in-page boots of the new systems still need a first real-device play (no
  non-NES ROMs were present on this machine).
