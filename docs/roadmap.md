# Roadmap

> **Up:** [↑ Docs](README.md)

Retro Game Player is a polished, Mac-native (Apple Silicon) retro-game player:
it manages a local game library with cover art and metadata across 20 classic
consoles, discovers and links (never downloads) game sources, and **plays
games in-page** — an embedded EmulatorJS core or a natively-hosted libretro
core, with external RetroArch as the fallback for everything else. It ships
**no** game content — it scans folders the user provides. Long-term, RGP's
ambition extends past retro: a frontend for **all** games on the system,
including Windows titles via CrossOver (see
[Horizon](#horizon--the-universal-frontend-ambition-unscheduled)). One `## vX.Y`
section per planned release; the integration master uses this file as the
primary input to `grm-release-planning`.

**North star:** a genuinely amazing retro videogame experience — pick up a
controller from the couch, browse a beautiful art-forward library, and be
*playing* seconds later, with your progress always kept. The v0.23+ arc below
works toward that in order of what hurts most today: progress is never lost →
every game plays inside Retro Game Player, fast → the library feels like
*yours* → the couch/TV experience → authentic retro presentation →
distribution to the world.

**Ambition rings (user-directed 2026-07-03):** the retro core is ring one,
not the ceiling. **Ring two — every game on the system:** non-retro titles
(Steam, GOG, bare `.app` bundles, …) join the same library, shelves,
controller-first TV mode, and launch flow, making RGP the frontend for *all*
games on the Mac. **Ring three — Windows games via CrossOver:** RGP
integrates with [CrossOver](https://www.codeweavers.com/crossover) to make
running Windows games on macOS easy, with RGP as the friendly frontend.
Neither ring is scheduled yet — see [Horizon](#horizon--the-universal-frontend-ambition-unscheduled)
below; the retro north star stays the near-term priority.
Gap analysis of record: issues
[#16](https://github.com/rhohn94/retro-game-player/issues/16)–[#29](https://github.com/rhohn94/retro-game-player/issues/29)
(filed 2026-07-01) plus the standing TV epic
[#8](https://github.com/rhohn94/retro-game-player/issues/8).

---

## v0.23 — Continuity (released — see version-history.md)

**Theme:** Never lose progress, never lie to the user. Closes the biggest
implementation-vs-ambition gap: today *nothing* persists — no battery saves, no
save states, on any play path — and play-path failures degrade silently.

- **Save states + SRAM/battery saves** on both the in-page and native paths,
  stored on disk under app-support; slot save/load in the in-game overlay; a
  "Continue" affordance on the detail page
  ([#16](https://github.com/rhohn94/retro-game-player/issues/16)).
- **Native-play closeout:** land/remove the in-flight crash-investigation
  diagnostics, run the real-device audio/load-time verification deferred from
  v0.21, and decide the default
  ([#18](https://github.com/rhohn94/retro-game-player/issues/18)).
- **Honest degradation:** visible in-app notice when a play path falls back
  (loopback bind failure, native-init failure, missing RetroArch)
  ([#19](https://github.com/rhohn94/retro-game-player/issues/19)).
- **Docs tell the truth:** refresh the v0.1-era README, populate
  `version-history.md`, and decide the license question
  ([#25](https://github.com/rhohn94/retro-game-player/issues/25),
  [#26](https://github.com/rhohn94/retro-game-player/issues/26) — decision + mechanical).

**Non-goals:** rewind, shaders, new cores.

Plan: [`release-planning-v0.23.md`](release-planning/release-planning-v0.23.md).

---

## v0.24 — Everywhere (released — see version-history.md)

Plan: [`release-planning-v0.24.md`](release-planning/release-planning-v0.24.md).

**Theme:** Every game plays *inside* Harmony, and it starts fast. Today only
NES boots in-page; the other ~19 catalogued systems shell out to an external
RetroArch the user must install.

- **In-page cores for the catalog:** bundle or on-demand-fetch EmulatorJS cores
  for the high-value systems (SNES, Genesis, N64, PS1, Atari 2600, …), with
  RetroArch fallback intact ([#17](https://github.com/rhohn94/retro-game-player/issues/17)).
- **Boot-latency spike:** warm-emulator ROM swap + decompressed-core cache
  ([#14](https://github.com/rhohn94/retro-game-player/issues/14)).
- **Player conveniences:** rewind / fast-forward / volume / pause-on-blur in
  the overlay ([#22](https://github.com/rhohn94/retro-game-player/issues/22)).
- **Direct download (user-requested):** wire the v0.16 per-vendor
  `direct_download` seam into a real, user-initiated download → import → play
  loop — off for every provider until the user enables it per vendor; streams
  through safeguards into the existing v0.12 import pipeline. Design:
  [`direct-download-design.md`](design/direct-download-design.md).

**Non-goals:** native (non-WASM) hosting beyond NES; torrents/resume/queue
manager for direct download.

---

## v0.25 — Scout (released — see version-history.md)

Plan: [`release-planning-v0.25.md`](release-planning/release-planning-v0.25.md).

**Theme:** User-requested — point Harmony at a site's base URL and its search
capability is discovered programmatically (OpenSearch / MediaWiki / WordPress /
HTML forms), plus a broader vetted provider catalog. Verified end-to-end
against a real OpenSearch provider (Wikipedia).

- **Provider API auto-discovery** from a base URL, wired into the Add-provider
  dialog beside Detect-from-URL.
- **Provider catalog expansion** with live-verified legitimate sources
  (Lexaloffle BBS, OpenGameArt, TheGamesDB, Hardcore Gaming 101).

**Non-goals:** a JSON result pipeline; open-web provider crawling.

---

## v0.26 — Theater (released — see version-history.md)

**Theme:** The couch release, user-directed (2026-07-02): the **entire 10-foot
TV epic** ([#8](https://github.com/rhohn94/retro-game-player/issues/8)) lands in one
pass — absorbing the formerly-planned v0.27 Theater and v0.28 Marquee — plus
controller completion and the product rename to **Retro Game Player**.

- **TV mode (leanback):** TV-safe margins + 10-foot type scale
  ([#9](https://github.com/rhohn94/retro-game-player/issues/9)), cover-art shelves with
  key-art hero ([#10](https://github.com/rhohn94/retro-game-player/issues/10)),
  distance-legible focus + snap navigation
  ([#11](https://github.com/rhohn94/retro-game-player/issues/11)), full-bleed
  ([#12](https://github.com/rhohn94/retro-game-player/issues/12)) high-resolution
  ([#13](https://github.com/rhohn94/retro-game-player/issues/13)) artwork, seamless
  game entry/exit transitions, optional auto-enter at startup.
- **Library-life data foundation** (subset of
  [#21](https://github.com/rhohn94/retro-game-player/issues/21)): favorites, recently
  played, play-time tracking across all three play paths (collections stay
  deferred).
- **Controller completion:** press-to-rebind remapping UI
  ([#20](https://github.com/rhohn94/retro-game-player/issues/20)) and an
  Xbox / PS4 (DualShock 4) / PS5 (DualSense) macOS compatibility audit.
- **Rename:** Harmony → **Retro Game Player** (configs, identifier with
  app-data migration, UI strings, docs, CSS token codemod; GitHub repo
  renamed at ship time).

**Non-goals:** collections UI (rest of #21), CRT gameplay filters (#23),
keyboard a11y (#29), notarized DMG (#27).

Plan: [`release-planning-v0.26.md`](release-planning/release-planning-v0.26.md).

---

## v0.27 — Immersion (released — see version-history.md)

**Theme:** Make playing a game in TV mode actually feel like a console —
driven by the 2026-07-03 couch playtest. Fullscreen takeover play (kill the
desktop "porthole" card), watertight controller-input scoping (a layered
exclusive-claim stack), the 5-second hover-attract live preview (strictly
no-trace), native-audio polish + persisted perf telemetry, and a full
25-seam TV-mode gap audit with 11 fixes.

(The version numbers v0.27/v0.28 were originally absorbed into v0.26
Theater — the former v0.27 "Theater" and v0.28 "Marquee" scopes shipped
there; this v0.27 is a new scope. v0.28 was un-retired for a new scope too —
see below; next planned versions remain v0.29 Craft and v0.30 Passport.)

Plan: [`release-planning-v0.27.md`](release-planning/release-planning-v0.27.md).

---

## v0.27.1 — EJS audio-warmup hotfix (released — see version-history.md)

**Theme:** Forward-port the abandoned `fix/audio-warmup` branch's
warm-then-reset cold-start fix onto the current EmulatorJS host page (user
directive, 2026-07-03) — EmulatorJS remains the primary in-page path for 7
systems plus the NES fallback, and every boot there still garbled audio for
~2–3s.

Plan: [`release-planning-v0.27.1.md`](release-planning/release-planning-v0.27.1.md).

---

## v0.28 — Living Room (released — see version-history.md)

**Theme:** The whole app from the couch, and a controller that doesn't fight
the games it's playing — three user directives from the same 2026-07-03
couch playtest that drove v0.27. Shrunk the TV hero band and made shelf
tiles responsive so ≥5 are always fully visible and never chopped (rails may
draw over the banner); added a Select/PlayStation-touchpad system menu so
every screen (Consoles, Search, Cores, Settings) is reachable without
leaving TV mode; and stopped the in-game overlay from eating a bare Start
press — it now opens only via a Start+Select chord or a 5s solo hold (with a
building progress-ring indicator), so every game's own use of Start works
unmodified.

(v0.28 was previously noted "stays retired" after its original "Marquee"
scope shipped inside v0.26 Theater — same reuse precedent as v0.27 above.)

Plan: [`release-planning-v0.28.md`](release-planning/release-planning-v0.28.md).

---

## v0.29 — Craft (released — see version-history.md)

**Theme:** Authentic retro presentation and engineering depth.

- **State-of-the-art, highly configurable CRT filter** — scanlines, screen
  curvature, color bleed, and related shader-style effects, with presets and
  per-parameter tuning, on both play paths where feasible
  ([#23](https://github.com/rhohn94/retro-game-player/issues/23)).
- **Emulation performance tooling (user directive, 2026-07-03):** an optional
  in-play FPS counter; profiling tools that record emulation performance
  (frame timing / audio ring health / core hot spots) to an easily-accessible
  file, reviewable both externally and from an in-app GUI panel. Builds on
  the native path's existing `logs/native-perf.log` (W270/W274) — extends
  that telemetry to be richer and to cover the EJS path too, plus surfaces it
  in the UI instead of a plain-text file only.
- **Per-core settings GUI (user directive, 2026-07-03):** a screen for
  adjusting libretro core options per-console/per-core (today set only via
  each core's own defaults) — needs a design pass on how core-specific
  option schemas are discovered/persisted (native cores vs. RetroArch-managed
  cores likely need different plumbing).
- **Keyboard accessibility:** focus-visible + full keyboard operability
  ([#29](https://github.com/rhohn94/retro-game-player/issues/29)).
- **Play-path integration tests** so a broken player fails CI, not manual QA
  ([#28](https://github.com/rhohn94/retro-game-player/issues/28)).

Plan: [`release-planning-v0.29.md`](release-planning/release-planning-v0.29.md).

---

## v0.29.1 — Native NES flip-fix hotfix (released — see version-history.md)

**Theme:** Fix a confirmed v0.29 regression — user-reported 2026-07-04: native
NES gameplay rendered vertically flipped. Root cause: W280's WebGL2 CRT-filter
renderer uploaded frames without compensating for the native core's top-down
buffer vs. WebGL's texture-origin convention.

- **Native NES rendering right-side-up again**, at every CRT preset including
  Off ([#37](https://github.com/rhohn94/retro-game-player/issues/37)).

Plan: [`release-planning-v0.29.1.md`](release-planning/release-planning-v0.29.1.md).

---

## v0.40 — Loose Ends (implementation complete — pending release)

**No single flagship.** Closes three independently-tracked backlog gaps
instead: the remainder of the keyboard-accessibility punch list
([#29](https://github.com/rhohn94/retro-game-player/issues/29)) that v0.38's
TV/dialog/settings pass didn't cover (Library/Search/Game-Detail keyboard
operability + ARIA audit), a core-options probe robustness follow-up from the
v0.29 review ([#33](https://github.com/rhohn94/retro-game-player/issues/33)),
and adopting Aura's real upstream TypeScript types in place of the hand-rolled
shim ([#40](https://github.com/rhohn94/retro-game-player/issues/40)).

**Non-goals:** everything else in the backlog (RA, Vulkan, i18n, Windows/Linux
ports, notarized DMG, metadata enrichment, etc.) — unchanged, carried from
v0.39 §4.

Plan: [`release-planning-v0.40.md`](release-planning/release-planning-v0.40.md).

---

## v0.39 — Focus (released — see version-history.md)

**Flagship: CRT filter presentation quality.** Decouple the native-path CRT
shader's rendering resolution from the emulated game's frame resolution —
the canvas backing store/viewport is sized to the host display's actual
resolution while the game frame itself keeps rendering at its own
system-native resolution, so scanline/curvature/color-bleed/vignette effects
render at full host fidelity instead of being computed tiny and blurred by a
later upscale (W390). Includes a design-doc architecture extension (W391),
GPU draw-cost perf verification at the new resolution (W392), and before/after
visual verification (W393). EJS/CSS-approximation path unchanged (existing
v0.29 non-goal).

**Non-goals:** EJS/CSS path changes, new CRT shader/effect variants, any
change to core emulation timing or frame content.

Plan: [`release-planning-v0.39.md`](release-planning/release-planning-v0.39.md).

---

## v0.38 — Tune-Up (released — see version-history.md)

**Flagship: quality, performance, polish.** A measured pass over the
engine and the v0.37 surfaces (user directive 2026-07-06): native
frame-path perf (lock + allocation hygiene, `texSubImage2D` uploads, real
GPU-cost measurement closing [#35](https://github.com/rhohn94/retro-game-player/issues/35)),
hardening of the achievements/collections code from the recorded v0.37
follow-ups, the full per-game achievement list with badge art, collection
rename/delete management UX, the
[#34](https://github.com/rhohn94/retro-game-player/issues/34) keyboard-a11y
punch list, and EJS cache GC + perf-log bounds
([#36](https://github.com/rhohn94/retro-game-player/issues/36)).

Plan: [`release-planning-v0.38.md`](release-planning/release-planning-v0.38.md).

---

## v0.37 — Trophies (released — see version-history.md)

**Theme:** RetroAchievements foundation (user directive 2026-07-06: autonomous
next-release cycle; roadmap's "strongest unclaimed community differentiator")
plus library collections, completing
[#21](https://github.com/rhohn94/retro-game-player/issues/21).

- **RetroAchievements, native NES/SNES** — rcheevos FFI + RA-correct hashing +
  per-frame trigger evaluation (W370), account/client/settings pane (W371),
  unlock toasts + local tracking (W372). Server submission, leaderboards, and
  EJS-path support deferred.
- **Collections** — schema, repo, IPC, detail-page picker, library filter, TV
  rails (W373; closes #21).
- **Small wins** — decompressed-core caching for in-page boots
  ([#31](https://github.com/rhohn94/retro-game-player/issues/31), W374); TV
  banner layered over hero art
  ([#38](https://github.com/rhohn94/retro-game-player/issues/38), W375).

Plan: [`release-planning-v0.37.md`](release-planning/release-planning-v0.37.md).

---

## v0.36 — Spring Cleaning (released — see version-history.md)

**Theme:** Code quality (user directive, 2026-07-05) — unhandled-error
observability, decomposition of the two worst oversized modules, duplication
collapse, dead-code removal, and targeted test depth. No user-visible
feature work.

- **Error-telemetry foundations** — Rust panic hook, frontend
  `onerror`/`unhandledrejection`, route-shell ErrorBoundary, shared IPC
  `swallow()` helper (W360), then remediation of the 53 silent-catch sites
  (W361).
- **Decompositions** — `SearchPage.tsx` (CC 34, 919 lines,
  [#43](https://github.com/rhohn94/retro-game-player/issues/43)) (W362) and
  `play/native/runtime.rs` (2306 lines) + callback clone-family collapse
  (W363).
- **Data-layer cleanup** — `db/repo/library.rs` row-mapper dedup + split;
  `play/server.rs` raw-SQL relocation, unwraps, brittle test (W364).
- **Dead code + duplication** — confirmed dead exports and the `fleet.ts`
  wrapper (W365); settings-pane/hook clone clusters (W366).
- **Test depth** — search-result logic, `import.ts`, `invoke.ts`, Rust
  command adapters (W367, partial
  [#28](https://github.com/rhohn94/retro-game-player/issues/28)).

Plan: [`release-planning-v0.36.md`](release-planning/release-planning-v0.36.md).

---

## v0.35 — Player Two (released — see version-history.md)

**Theme:** Two-controller multiplayer for NES and SNES (user directive,
2026-07-05) — a second connected controller is picked up automatically by
the emulators, no configuration required.

- **Per-port native input** — `set_native_input` gains a port; the libretro
  `input_state` callback honors the polled port; joypads announced on ports
  0–1 (W350).
- **Two-controller capture + lifecycle** — NativePlayer polls all pads,
  stable automatic pad→port assignment, disconnect release/reclaim, P1/P2
  indicator (W351).
- **EJS fallback two-player** — verify/config EmulatorJS player-2 auto
  assignment on the loopback host page (W353).

**Non-goals:** >2 players, manual port-swap UI, per-player rebinding,
N64/PS1 multiplayer claims, second-pad menu navigation.

Plan: [`release-planning-v0.35.md`](release-planning/release-planning-v0.35.md).

---

## v0.34 — Engines (released — see version-history.md)

**Theme:** Every popular platform plays on the native emulation engine
(user directive, 2026-07-05) — generalize the v0.21 NES-only native libretro
host into a multi-system engine.

- **Native host generalization** — per-system table, `av_info`-driven
  geometry/timing, frontend gating (W340).
- **Catalog expansion** — GB/GBC/GBA + Wii join the 20-console catalog,
  scanner, and EJS fallback tier (W341).
- **Software-render native cohort** — SNES, Genesis, Master System, GB/GBC,
  GBA, Atari 2600, PC Engine on the native engine (W342).
- **Disc-image identification** — `.cue`/`.chd`/`.bin` sniffing so PS1 discs
  enter the library (W343); **PS1 native** via pcsx_rearmed (W344).
- **HW-render subsystem** — OpenGL context + FBO readback in the native
  host; **N64 native** (W345); **GameCube/Wii stretch** via dolphin (W346).
- v0.33 reviewer riders (W347).

**Non-goals:** multiplayer/two-controller work (v0.35 next), netplay,
multi-disc swap UI, NSView/Metal overlay, PS2/Saturn/Dreamcast native.

Plan: [`release-planning-v0.34.md`](release-planning/release-planning-v0.34.md).

---

## v0.33 — Bottles (released — see version-history.md)

**Theme:** Horizon H2, first slice — CrossOver bottles on the shelves.

- **Persisting-source trait** — the W322 follow-through so CrossOver lands
  as just another `GameSource` (W330).
- **CrossOver detection + bottle/app enumeration** as a `crossover` source,
  migration 014 (W331).
- **CrossOver launch** — descriptor kind → CrossOver CLI argv, app-focus
  play sessions, "Launches via CrossOver" detail/TV copy (W332).
- Carryover riders: `Db::open` busy_timeout + scanner guards + W322 test
  dedup (W334); DMG-pipeline fix
  [#45](https://github.com/rhohn94/retro-game-player/issues/45) (W335).
- **Deferred:** the guided "run a Windows game" install flow (v0.34
  candidate).

Design: [`crossover-integration-design.md`](design/crossover-integration-design.md).
Plan: [`release-planning-v0.33.md`](release-planning/release-planning-v0.33.md).

---

## v0.32 — Sources Complete (released — see version-history.md)

**Theme:** Finish Horizon H1 — every game on the system discoverable, with art.

- **GOG + itch scanners** as additive `GameSource` implementations (W320).
- **SteamGridDB art** for non-Steam titles — keyed client, fallback chain
  Steam CDN → SteamGridDB → bundled icon (W321).
- **ROM scanner migrated onto `GameSource`** — retro becomes just another
  source (W322).
- Carryover follow-ups: art-fetch detachment + icon-failure logging (W323);
  FK scope-guard, shared gating helpers, familiar DTO fields (W324).

Design: [`non-retro-library-design.md`](design/non-retro-library-design.md).
Plan: [`release-planning-v0.32.md`](release-planning/release-planning-v0.32.md).

---

## v0.31 — Frontier (released — see version-history.md)

**Theme:** Non-retro games join the library — Horizon H1, first slice.

- **ROM-less library rows** — nullable rom identity, `source` +
  `launch_descriptor` columns (W310).
- **Launcher abstraction** — `open -a` / `steam://` / custom-exec descriptors
  generalizing the RetroArch-only external play path, app-focus play
  sessions (W311).
- **Pluggable game sources** — Steam appmanifest scan (W312), `/Applications`
  heuristics + manual entries (W313).
- **Steam CDN art** on shelves and TV (W314); **first-class non-retro UI**
  across shelves/detail/TV (W315).
- Docs-hygiene rider [#41](https://github.com/rhohn94/retro-game-player/issues/41) (W316).

Design: [`non-retro-library-design.md`](design/non-retro-library-design.md).
Plan: [`release-planning-v0.31.md`](release-planning/release-planning-v0.31.md).

---

## v0.30 — Passport (released — see version-history.md)

**Theme:** Ready for hands that aren't the developer's.

- **Notarized, stapled Developer-ID DMG** that launches clean on a fresh Mac
  ([#27](https://github.com/rhohn94/retro-game-player/issues/27)).
- License follow-through if not already closed in v0.23
  ([#26](https://github.com/rhohn94/retro-game-player/issues/26)) — already closed in
  v0.23; not part of v0.30 scope.

Plan: [`release-planning-v0.30.md`](release-planning/release-planning-v0.30.md).

---

## Horizon — the universal-frontend ambition (unscheduled)

> Scope directive (2026-07-03): *"Expand scope and ambition of this project to
> include playing NON retro games via the frontend interface. In the distant
> future, it will be usable as a frontend for all games on the system. In the
> future, it will support interacting with CrossOver to make it easy to run
> Windows games on MacOS by using RGP as the frontend."*

Two staged epics, H1 before H2 (H2's CrossOver entries are a
launcher/source pairing built on H1's abstractions). Earliest realistic slot
is after v0.30 Passport; each gets a real design doc + release plan when
scheduled. Everything the app already does for retro games — art-forward
shelves, TV mode, controller-first navigation, play-session tracking — is
the product surface these epics plug new game *sources* and *launchers* into.

### H1 — Non-retro games in the library (frontend for everything installed)

- **Pluggable game sources** beyond the ROM scanner: discover installed
  titles from Steam (appmanifests under
  `~/Library/Application Support/Steam/steamapps`), `/Applications` `.app`
  scanning with game heuristics, GOG/itch installs; user-added manual
  entries as the escape hatch.
- **Launcher abstraction:** generalize the existing external-launch play
  path (today RetroArch-only) into a per-game launch descriptor —
  `open -a`, `steam://rungameid/<id>` URL schemes, custom exec + args —
  same detail page and TV launch flow, with play-session start/stop tracked
  by app-focus observation instead of process exit where needed.
- **Library model:** `games` rows without a ROM hash — nullable
  hash/system, plus source + launch-descriptor columns; shelves, filtering,
  favorites, and play-time treat non-retro entries as first-class.
- **Art & metadata for non-retro titles:** Steam CDN header/hero art maps
  naturally onto the TV shelves; SteamGridDB is the candidate for
  everything else.
- **Non-goals:** storefront purchases, install/uninstall management,
  in-page play for native titles (they launch externally by definition).

### H2 — CrossOver integration (Windows games on macOS)

- **Detection & enumeration:** find a CrossOver install, enumerate its
  **bottles** and each bottle's installed Windows applications (bottle
  metadata / CrossOver CLI), and surface them as library entries.
- **Launch:** one click / controller press from the shelves runs the
  Windows title through CrossOver's CLI — the TV couch flow, for Windows
  games.
- **Ease-of-use flow:** a guided "run a Windows game" path — pick an
  installer or `.exe` → choose/create a bottle → the game appears in the
  library. RGP as the friendly face of CrossOver.
- **Boundary:** RGP orchestrates CrossOver; it never ships, patches, or
  configures Wine itself. CrossOver stays a user-installed prerequisite,
  exactly like RetroArch today.

---

## v0.22 — Polish

**Theme:** A code-quality and UX consistency pass, not a new feature — origin
is a fresh 4-agent audit (coding-practices, architecture, dead-code/
duplication, UX consistency) run against `docs/coding-standards.md`,
`docs/architecture-guidelines.md`, and `docs/design/ux/design-language.md`
after v0.21 shipped.

- **Bug fixes:** a search-thread panic-on-join that could crash a whole search
  instead of degrading one provider's result; the controller focus-ring
  lingering on a stale element when mouse and gamepad input mix.
- **Structure:** extract a shared `useCancellableEffect` hook (was hand-rolled
  9+ times); split `SearchPage.tsx` and `SettingsPage.tsx` along their
  components/panes; clean up two IPC-boundary leaks and one cross-feature
  encapsulation violation (`play/` gains a public barrel).
- **Consistency:** unify empty/error/loading states across Search/Cores to
  match Library/Consoles; fix a hardcoded motion literal, a hand-rolled
  button/selected-state in Settings' Appearance pane, and a spacing outlier.

Plan: [`release-planning-v0.22.md`](release-planning-v0.22.md).

---

## v0.1 — Foundation

**Theme:** A runnable, beautiful native shell that scans a real library, manages
NES/SNES/N64 cores, launches games through RetroArch, and is navigable entirely
by controller — with fleet identity and telemetry wired from day one.

- **Native shell:** Tauri 2.0 (Rust) + React + TypeScript + Aura design language
  + Framer Motion, running on macOS arm64.
- **Native vibrancy seam:** blurred cover-art backdrops and translucent shelves
  via Tauri's native `NSVisualEffectView` window vibrancy (Rust window layer) —
  **not** CSS `backdrop-filter`; Aura/React renders content on top.
- **Library:** user-configured content folders; scanner walks + hashes
  (CRC32/MD5), matches against No-Intro DAT files for clean titles + dedupe;
  file → system → core mapping; persisted in SQLite.
- **Core management:** download/update Apple-Silicon (arm64) cores from the
  libretro buildbot; install/update/select active core per system; verified
  downloads under the app-support dir. (NES → Mesen/FCEUmm; SNES →
  Snes9x/bsnes; N64 → Mupen64Plus-Next.)
- **Launch:** shell out to RetroArch with the right core + content path.
- **Controller (first-class):** full grid/menu navigation, launch, and
  back/quit via controller alone (Xbox / PlayStation / 8BitDo / Switch Pro);
  on-screen focus states + button hints; bindings stored in SQLite.
- **Metadata & art:** box art / titles / snaps from the free
  libretro-thumbnails repos (No-Intro names) with local caching; graceful
  fallback art.
- **File search (source-agnostic):** generic module querying user-supplied
  providers (name + URL template); displays links only, never auto-downloads;
  ships with the provider list **empty**.
- **Settings:** folders, cores, controllers, and search providers.
- **Fleet identity (Ensign):** instance ID + version manifest; deployed-instance
  layout mirroring `deployed-apps/familiar` (`versions/{vX.Y.Z}/` + `current`
  symlink) so Mission Control's Fleet pillar can reconcile this app.
- **Telemetry:** `run.json` wired.
- **Dependency Channel:** `vendor.toml` populated (Aura + shared crates), synced
  via `grm-sync-deps` / `grm-vendor-migrate`.
- **Ship:** GitHub Release cut for v0.1 (`gh release create` path on).

**Non-goals for v0.1:**
- Writing any emulation (we orchestrate RetroArch + libretro cores).
- Bundling or shipping any game content.
- ScreenScraper metadata (needs the user's own API key — deferred to v0.2).
- Systems beyond NES / SNES / N64.

Plan: [`release-planning-v0.1.md`](release-planning-v0.1.md).

---

## The GUI-and-cores program (v0.2 – v0.7)

v0.1 built the full Foundation, but the app shipped **blank**: two defects (an
Aura-runtime init-order crash and an inverted CSS cascade-layer order) stopped
React from mounting, and the smoke gate never noticed because it only checked
that an artifact file existed. This six-release program first makes the app
**visible and self-verifying**, then completes and hardens the GUI and the
emulator-core lifecycle end-to-end. v0.3–v0.7 are **provisional** — each is
re-planned against the now-working app using v0.2's tooling rather than guessed
in advance.

Enrichment & polish (ScreenScraper, Familiar AI, richer controller-binding UI)
and broader system coverage — the previous v0.2/v0.3 themes — move to **after**
this program (see [Backlog](#backlog)).

---

## v0.2 — Sight

**Theme:** Make the app render, and make the GUI self-verifying so a blank or
crashed UI can never again pass a green build.

- **Blank-screen fix:** load the Aura runtime as a classic render-blocking
  `<head>` script so its `ready()` callback defers correctly (was crashing on
  `Aura.icons` undefined); order the CSS cascade layers so Harmony's theme
  overrides win over Aura defaults.
- **Verified visual inspection:** the headless capture now asserts the React
  tree mounts and renders on every route, captures console + uncaught errors,
  and **exits non-zero on a blank/crashed GUI** — wired into `smoke`.
- **Mock IPC harness (closes T4):** deterministic Tauri-IPC fixtures so screens
  render populated headlessly; multi-route screenshots + machine-readable report.

Plan: [`release-planning-v0.2.md`](release-planning-v0.2.md).

---

## v0.3 — Resonance

**Theme:** Adopt the Aura design language fully and drive the UI from design
tokens rather than ad-hoc CSS.

- **Harmony token layer:** a `--harmony-*` set (geometry, typography scale,
  off-scale spacing/radius, a shared focus ring) declared in the `harmony-theme`
  cascade layer for the values Aura's own scale does not own.
- **Token adoption:** the shell (`App.tsx`), `library.css`, `cores.css`, and the
  screens all reference tokens; every `var(--aura-*, <literal>)` colour fallback
  removed; `--aura-error` aliased to Aura's `--aura-danger` so the error colour
  is theme-driven.
- **Guard:** `scripts/token-adoption.test.mjs` fails the build if a colour
  literal or bare hex returns; verified rendering unchanged vs v0.2.

Ticket [#1](https://github.com/rhohn94/retro-game-player/issues/1) · Plan:
[`release-planning-v0.3.md`](release-planning-v0.3.md).

---

## v0.4 — Motion

**Theme:** Smooth, fluid animation for every transition and event, on a single
motion-token source, centrally honouring `prefers-reduced-motion`.

- **Single motion source:** `src/lib/motion.ts` (Framer durations/spring
  presets/variants) + `src/theme/motion.css` (CSS duration/easing tokens
  forwarding Aura's primitives). Existing motion refactored onto it; no raw
  spring/duration literals remain in components.
- **Gaps closed:** route crossfade (`AnimatePresence` keyed by pathname), library
  grid stagger, provider-dialog pop, sidebar-nav / tab / result-row transitions.
- **Reduced motion** honoured in two places only — `<MotionConfig
  reducedMotion="user">` + the global CSS media query — guarded by
  `scripts/motion.test.mjs`.

Ticket [#2](https://github.com/rhohn94/retro-game-player/issues/2) · Plan:
[`release-planning-v0.4.md`](release-planning-v0.4.md).

---

## v0.5 — Threshold

**Theme:** Let Harmony offer to create a games directory for the user, so an
empty library has a one-click path to a real, scannable folder.

- **Backend:** `AppConfig.games_dir` + `create_games_folder` / `suggest_games_dir`
  commands — idempotent `create_dir_all`, absolute-path + system-dir safety
  guards, persistence; Tauri-free inner fn with full unit tests.
- **Frontend:** a confirm-first `CreateGamesFolderDialog` (editable pre-filled
  path, no silent writes) wired into the Library and Settings → Folders empty
  states; chains create → add-content-folder → rescan.
- **Verify:** `scripts/inspect-empty-states.mjs` screenshots the empty-state
  affordance (the standard inspect uses populated fixtures).

Ticket [#3](https://github.com/rhohn94/retro-game-player/issues/3) · Plan:
[`release-planning-v0.5.md`](release-planning-v0.5.md) · Design:
[`games-directory-design.md`](design/games-directory-design.md).

---

## v0.6 — Lens

**Theme:** Built-in search providers and a multi-facet library filtering
experience.

- **Built-in providers:** migration-seeded, links-only providers (MobyGames,
  IGDB, Wikipedia, GameFAQs) — Harmony only opens a constructed link.
- **Metadata columns:** nullable `year`/`developer`/`publisher`/`aliases` added to
  `games` (forward-compatible; null until enrichment exists).
- **Filtering:** a pure tested `filter.ts` + a `LibraryFilters` bar (console
  pills, title/alias search, year/developer/publisher selects) combining facets
  with AND and **hiding facets with no values** (graceful degradation).

Ticket [#4](https://github.com/rhohn94/retro-game-player/issues/4) · Plan:
[`release-planning-v0.6.md`](release-planning-v0.6.md) · Design:
[`library-filtering-design.md`](design/library-filtering-design.md).

---

## v0.7 — Forge

**Theme:** Discovery (browse), search, and download for emulator cores — built on
the existing real download/verify/install path.

- **Broadened catalog:** `system_map.rs` expanded to well-known libretro cores
  (nes: mesen/fceumm/nestopia/quicknes; snes: snes9x/bsnes/snes9x2010; n64:
  mupen64plus_next/parallel_n64) so there is a real catalog to discover.
- **Browse + search:** a pure tested `coreFilter.ts` + a `CoresPage` search box
  that switches to a flat, all-systems result list (grouped by system); install /
  update / set-active flow through the existing real backend.
- The download itself was already real (buildbot fetch → arm64 verify → atomic
  write → persist); v0.7 makes it discoverable and searchable.

Ticket [#5](https://github.com/rhohn94/retro-game-player/issues/5) · Plan:
[`release-planning-v0.7.md`](release-planning-v0.7.md) · Design:
[`core-discovery-design.md`](design/core-discovery-design.md).

**This completes the GUI-and-cores program (v0.2 – v0.7).**

---

## v0.8 — Confirm

**Theme:** A UX follow-up to a user-reported bug. The "Create a games folder"
flow used to close silently on success; since a fresh folder is empty, the
Library stayed empty and it looked like nothing happened.

- The dialog now shows a **"✓ Games folder ready"** confirmation with the created
  path and a **Reveal in Finder** button (`revealItemInDir`, already covered by
  `opener:default`); the library/settings views still refresh.

Plan: [`release-planning-v0.8.md`](release-planning-v0.8.md).

**Backlog (filed, not started):** searching for game downloads
([#6](https://github.com/rhohn94/retro-game-player/issues/6)) and expanding the console
list to gens 1–6 ([#7](https://github.com/rhohn94/retro-game-player/issues/7)).

---

## v0.9 — Contact

**Theme:** Repair the whole Aura interaction layer so buttons, text fields, and
selects actually respond to real user input.

An audit of all 7 interactive component files found 17 controls wired against an
**imagined** Aura API: 11 buttons listened for an `aura-click` event Aura never
dispatches (it fires native `click`); 4 `<AuraField>`s carried input props with
no contained `<input>` (the wrapper renders none); 2 `<AuraSelect>`s used native
`<option>` children + a hyphenated `aura-change`. The two user-reported bugs
(the dead "Create a games folder" button and the untypeable Search box) were
symptoms of this. Fixes follow patterns already working in-repo (`onClick`,
contained `<input>`, native `<select>`).

- **Buttons → `onClick`**, **fields → contained `<input>`** (shared
  `.harmony-input`), **selects → native `<select>`**.
- **Guard:** `scripts/aura-wiring.test.mjs` fails on any dead event literal or
  prop-driven `AuraField`; `scripts/inspect-interactions.mjs` drives the UI with
  **real** clicks/typing and asserts the state change (the old scripts faked the
  event they were verifying).

Plan: [`release-planning-v0.9.md`](release-planning-v0.9.md) · Design:
[`interaction-wiring-design.md`](design/interaction-wiring-design.md).

---

## v0.10 — Lineage

**Theme:** Expand the default console list from NES/SNES/N64 to all home consoles
of generations 1–6, so discovery, scanning, the core catalog, and filtering
cover the classic era.

- **Catalog:** `system_map.rs` curates 20 systems (gen 2–6 home consoles + the
  original three) with ≥1 libretro core each — every core id verified against the
  live arm64 buildbot index (195 cores), so downloads never 404. Gen 1
  dedicated/Pong consoles and the original Xbox are documented omissions (no
  ROM/core path).
- **Scan:** `mapper.rs` reimplemented over a single `SYSTEMS` table; adds the
  **unambiguous** ROM extensions for the new cartridge systems (+ Dreamcast/
  GameCube). Ambiguous CD container formats (`.cue`/`.chd`/…) stay discoverable
  in the catalog but are not auto-scanned. A test pins each scan default core to
  the catalog's recommended core.
- **Frontend:** no change needed — the Cores screen and library console filter
  derive systems from the data and pick up the new consoles automatically.

Closes [#7](https://github.com/rhohn94/retro-game-player/issues/7) · Plan:
[`release-planning-v0.10.md`](release-planning-v0.10.md) · Design:
[`console-catalog-design.md`](design/console-catalog-design.md).

---

## v0.11 — Quarry

**Theme:** Search for game downloads — discover and link downloadable games from
the search screen and a game's detail page, strictly links-only.

- **Provider kinds:** a `kind` column (migration 004) splits providers into
  `reference` (v0.6 metadata seeds) and `download`. Seeds two **legal**,
  links-only download homes — the Internet Archive and itch.io. Harmony ships no
  links to copyrighted-ROM sources; users may add their own providers.
- **Contract preserved + tested:** `run_search` only substitutes templates —
  there is no fetch path — so "no bytes downloaded" is structural; a test pins
  every seeded download template to a link (`https://…{query}`). The Search
  header states the link-only contract; download providers are marked `⬇`.
- **Find downloads for a title:** the game detail page jumps to a pre-filled,
  auto-run search for the game's title.

Closes [#6](https://github.com/rhohn94/retro-game-player/issues/6) · Plan:
[`release-planning-v0.11.md`](release-planning-v0.11.md) · Design:
[`download-search-design.md`](design/download-search-design.md).

---

## v0.12 — Curator

**Theme:** Curate your library — add games directly, enrich them automatically,
and explore the whole console landscape.

- **Add a game (import):** drag-and-drop a ROM onto the window or pick it with the
  native file dialog (`tauri-plugin-dialog`). Imported files are identified by
  extension, copied into the managed Games directory (`<games_dir>/<system>/`),
  registered, and made launchable — idempotent and never-clobbering.
- **Auto-metadata on add:** each new game fetches cover art (libretro CDN) and a
  Wikipedia summary + article URL (`games.description`, migration 005), surfaced on
  the detail page with a manual "Refresh metadata" action. Best-effort — a miss
  degrades silently.
- **ROM-site download providers:** a curated set of emulator/ROM sites seeded as
  `kind='download'` providers (migration 005), upholding the links-only contract
  (Harmony constructs a `{query}` link and never downloads).
- **By Console:** a new `/consoles` browse grid (generation-grouped, searchable,
  with downloaded photos + Wikipedia descriptions) and a `/console/:key` detail
  view showing your owned games plus the console's **entire** known game catalog —
  ~28.6k titles across all 20 consoles, generated from the community
  libretro-database datfiles (names only) and embedded in the binary.

Design: [`library-import-design.md`](design/library-import-design.md),
[`console-browse-design.md`](design/console-browse-design.md).

---

## v0.13 — Reveal

**Theme:** Make on-disk images actually appear.

- **Asset protocol enabled:** cover art (`art-cache/`) and console photos
  (`console-art/`) are cached to disk and referenced via Tauri's `asset:`
  protocol (`convertFileSrc`), but the protocol was never enabled in
  `tauri.conf.json`, so the webview blocked every image. v0.13 enables it with a
  narrow scope (`$APPDATA/art-cache/**`, `$APPDATA/console-art/**`) so cover art
  and console photos render. User-reported fix, verified in the running app.

Plan: [`release-planning-v0.13.md`](release-planning-v0.13.md).

---

## v0.21 — Bedrock

**Theme:** Host the `fceumm` NES core natively (FFI via `libloading`) instead
of in EmulatorJS/WASM, to fix the Web Audio cold-start audio garble
([#15](https://github.com/rhohn94/retro-game-player/issues/15)) and cut load time at the
root. Ships behind a flag; EmulatorJS stays the path for every other system
and as the automatic fallback if native init fails.

- **Native core hosting:** hand-rolled libretro FFI (no maintained Rust crate
  hosts prebuilt cores — confirmed by research) loads the already-installed
  `fceumm` `.dylib` (reusing the v0.7 core-install pipeline, no new bundling
  work) and runs it directly in the Rust backend.
- **Native audio:** `cpal`/CoreAudio output fed by a ring buffer from the
  core's audio callback — no Web Audio, no cold-start garble.
- **Frame delivery:** decoded frames pushed to a `<canvas>` via Tauri IPC.
- **Input:** the same keyboard/gamepad bindings that already drive the
  EmulatorJS path drive the native one (`src/features/controller/` gamepad
  state + EmulatorJS-equivalent keyboard defaults), pushed into the core each
  poll tick.
- **Settings toggle:** off by default; the runtime switch falls back to
  EmulatorJS automatically if native init fails for any reason.
- **Boundary:** NES-only proof this release; broader core coverage, save
  states, a native NSView overlay, and the preview-then-play attract mode are
  explicit follow-ups, not built here.
- **Real-device verification still pending:** the audio-cleanliness and
  load-time acceptance criteria need an installed `fceumm` core + a real ROM
  to verify by ear/clock, neither of which exists in the dev sandbox — see
  `release-planning-v0.21.md` §5 Follow-ups.

Design: [`native-emulation-design.md`](design/native-emulation-design.md) ·
Plan: [`release-planning-v0.21.md`](release-planning-v0.21.md).

---

## v0.20 — Atlas

**Theme:** Make adding a provider first-class. Rather than hand-crafting URL
templates, the user discovers providers from a curated, searchable catalog and
adds them in one click — with clear guidance, template auto-detection, and a live
test for custom ones. The no-download contract is untouched.

- **Browse providers (curated catalog):** a searchable, media-filterable gallery
  of vetted legitimate sources (storefronts, indie/homebrew & demoscene archives,
  libraries, reference sites) — one-click add, with JavaScript-rendered sites
  honestly flagged.
- **Guided authoring:** the Add-provider dialog gains inline requirement help, a
  reference/download Type selector, and "Detect from URL" — paste a results URL
  and it derives the `{query}` template.
- **Test provider:** a live validator runs a sample query and reports how many
  links it found (with samples), warning when a site is JavaScript-rendered.
- **Boundary:** discovery is a curated catalog + detect-from-URL, not an open-web
  finder for download sites. JS-render support for itch.io/GameJolt is the next
  release.

Design: [`provider-discovery-design.md`](design/provider-discovery-design.md) ·
Plan: [`release-planning-v0.20.md`](release-planning-v0.20.md).

---

## v0.19 — Reach

**Theme:** Ship the two deferred differentiators and broaden where search
reaches. v0.16–v0.18 made one provider's results browsable and relevant; v0.19
merges the same game across providers, lets the user check whether a link is
still alive, and seeds more legal, scrape-compatible sources — the no-download
contract untouched.

- **Cross-provider dedupe → game-first view:** a Group **By game** toggle merges
  the same title found across providers into one row with an "available from N
  providers" expander, so you pick the source. Provider-first grouping stays the
  default.
- **Link liveness (opt-in):** a "Check links" toggle HEAD-probes each previewed
  link (a probe, not a download) and marks it alive / dead / unknown with a
  colored dot — bounded by a URL cap, short timeout, and capped concurrency, off
  by default.
- **Broader provider reach:** seven vetted, server-rendered providers added
  (Steam, PDRoms, Demozoo, Pouët, Lemon Amiga, Zophar's Domain, ROMhacking.net);
  JS-only storefronts that a static fetch can't scrape were excluded.
- **Contract honesty:** the "legal sources only" wording is corrected to reflect
  that the seeded set has spanned general ROM sites since v0.12 — Harmony links
  out and never downloads; legality of any link is the user's responsibility.

Design: [`download-browsing-ux-design.md`](design/download-browsing-ux-design.md) §8 ·
Plan: [`release-planning-v0.19.md`](release-planning-v0.19.md).

---

## v0.18 — Focus

**Theme:** Make results *relevant*. v0.16/v0.17 preview and browse what a
provider returned, but the scrape grabs every link on the page in DOM order with
no sense of what was searched. v0.18 drops the junk at the scrape, ranks results
so the searched-for game leads and is indicated with a Match badge, and lets
search specify structured fields (console, region) beyond the bare game name —
the no-download contract untouched.

- **Junk-link filtering:** the scraper drops obvious page chrome (pagination,
  exact-match nav/legal/social words like Home/Login/Next, too-short anchors)
  before it becomes a result — conservatively, never a real game title.
- **Relevance ranking + Match badge:** a new Relevance sort (now the default)
  orders each provider's rows by query relevance, and strongly/partially
  matching rows carry a Match / Partial chip so the searched-for game is
  visibly indicated. Weak matches are demoted, with an off-by-default
  "Hide unlikely matches" toggle.
- **Structured search fields:** a console select (from the console catalog) and
  a region select feed the relevance ranking, and — per a new per-provider
  opt-in — are composed into that provider's query to narrow at the source.

Design: [`download-browsing-ux-design.md`](design/download-browsing-ux-design.md) §7 ·
Plan: [`release-planning-v0.18.md`](release-planning-v0.18.md).

---

## v0.17 — Sift

**Theme:** Make the v0.16 preview *browsable*. Once Harmony shows the candidate
links each provider surfaced, v0.17 lets the user sift to the one they want —
fold, filter, sort, badge, and batch-open — all on the already-scraped title +
URL, with the no-download contract untouched.

- **Collapsible provider groups:** each provider's results fold under a header
  toggle (chevron + name + count/error badge) with an Expand-all / Collapse-all
  toolbar; empty and errored groups start collapsed so populated providers lead.
- **Live result filter:** a fast-filter box instantly narrows visible rows by a
  case-insensitive substring over title + URL; group counts and the summary
  reflect the filtered totals.
- **Sort + persisted preference:** order rows Found (scrape order), Title A→Z, or
  Title Z→A; the choice persists across searches and restarts.
- **Multi-select + open in browser:** per-row and per-group checkboxes with a
  selection footer that opens every chosen link in the system browser (with a
  confirm above ten tabs) — Harmony still never downloads anything itself.
- **Title-parsed badges:** compact chips parsed from the anchor text — region
  (USA/EUR/JPN/…), revision (Rev A / v1.1), dump-quality (`[!]`/`[b]`/…), and
  file type — modelled on the *arr stack's quality badges.

Design: [`download-browsing-ux-design.md`](design/download-browsing-ux-design.md) ·
Plan: [`release-planning-v0.17.md`](release-planning-v0.17.md).

---

## v0.16 — Trove

**Theme:** See what you found before you go get it. Search stops being a bare
link-out: Harmony now previews the candidate files each provider surfaces, in
the app, and lets the user open the one they want in their browser — while never
downloading anything itself.

- **In-app result preview:** `run_search` fetches each enabled provider's public
  search-results page, scrapes the candidate links from its HTML, and returns
  them grouped per provider with the provider's own search-page link as a
  fallback. Generic + source-agnostic (no per-site parsers), behind strict
  safeguards (http(s)-only, 8 s timeout, 2 MiB body cap, 30-result cap,
  concurrent per-provider fetch). The genuinely-load-bearing contract is intact:
  Harmony **never downloads content** — the user opens their chosen link in
  their browser.
- **Per-vendor direct-download scaffolding:** a `direct_download` capability flag
  (migration 007) plumbed through the repo, IPC DTOs, provider add/edit dialog,
  and a clearly-disabled results marker — groundwork for a future, optional,
  per-vendor direct-download feature. Ships off for every provider; no download
  action is wired yet.
- **Compliance & hygiene (carried in):** third-party GPL-3.0 license attribution
  for the bundled EmulatorJS + cores (`THIRD-PARTY-NOTICES.md`), and an
  isolation fix for the intermittently-flaky parallel `cargo test` suite.

Design: [`download-search-design.md`](design/download-search-design.md) ·
Plan: [`release-planning-v0.16.md`](release-planning-v0.16.md).

---

## v0.15 — Arcade

**Theme:** Play, live and in-page. Second of three grouped releases in the
8-feature program — a supported game now boots **inside** the Harmony detail
screen, with sound, as part of the retro vibe.

- **In-page play:** NES titles auto-boot in an embedded EmulatorJS WASM core
  served from a loopback `http://127.0.0.1` origin (the only reliable way to host
  EmulatorJS's Worker/WASM pipeline under the `tauri://` scheme); systems without
  a bundled in-page core fall back to the native external-RetroArch launch.
- **In-game overlay + immersive mode:** while the player is mounted it owns the
  controller; the menu/Start button, controller back, or Escape summon a Harmony
  overlay (Resume / Full screen / Exit) that pauses the game, and "Full screen"
  enters a window-fullscreen immersive mode the overlay renders over.
- **Seamless transitions:** the player frame fades in as the game boots and the
  overlay animates in/out via the shared motion presets.

Design: [`in-page-play-design.md`](design/in-page-play-design.md) ·
Plan: [`release-planning-v0.15.md`](release-planning-v0.15.md).

---

## v0.14 — Lounge

**Theme:** The couch / big-picture experience. First of three grouped releases
covering an 8-feature program (controller, fullscreen, specs, in-page play +
overlay + transitions, and downloads).

- **Controller navigation:** the built-but-unwired W14 controller stack is
  connected to the shell — the sidebar nav and library tiles are spatial-focus
  targets, `confirm` activates, and the B button backs out. Mouse/keyboard
  unchanged.
- **Fullscreen:** F11 or a focusable sidebar button toggles the Harmony window
  into OS fullscreen (`useFullscreen` + `core:window` capabilities).
- **Console hardware specs:** each console detail page shows a CPU / GPU / RAM
  table (`ConsoleInfo` gains static spec fields for all 20 consoles).

Design: [`presentation-shell-design.md`](design/presentation-shell-design.md) ·
Plan: [`release-planning-v0.14.md`](release-planning-v0.14.md).

---

## Backlog

Beyond the v0.23–v0.29 arc (unscheduled; former backlog rows now live as
scheduled tickets — enrichment → [#24](https://github.com/rhohn94/retro-game-player/issues/24),
controller-binding UI → [#20](https://github.com/rhohn94/retro-game-player/issues/20),
collections/favorites/play-time → [#21](https://github.com/rhohn94/retro-game-player/issues/21),
notarized DMG (T2) → [#27](https://github.com/rhohn94/retro-game-player/issues/27)):

- **Metadata enrichment** ([#24](https://github.com/rhohn94/retro-game-player/issues/24)):
  ScreenScraper (user API key) + Familiar AI fuzzy matching / dump
  disambiguation; candidate for v0.30.
- **Native hosting beyond NES:** SNES/Genesis/N64 cores on the v0.21 FFI layer;
  native NSView/Metal frame overlay; preview-then-play attract mode
  (native-emulation-design.md follow-ups).
- **RetroAchievements** integration (retroachievements.org) — the strongest
  unclaimed community differentiator.
- **Netplay** (research-class; likely via RetroArch orchestration first).
- **Windows / Linux** ports (Tauri is cross-platform; the vibrancy seam and
  RetroArch locator are the macOS-bound pieces).
- **Localization (i18n)** — all UI strings are hard-coded English today.
- **JS-render fetch tier** (carried from the v0.21/v0.22 ledgers): offscreen
  WebView render-then-scrape so JS-only providers (itch.io, GameJolt, GOG)
  become previewable; pairs naturally with direct download (#30).
- More art fallbacks; search size/age columns; search history.

---

## Framework-required (baseline)
<!-- seeded by onboarding from baseline-requirements.md (baseline-version: 3) -->

These are framework-mandated capabilities that make Harmony self-verifiable by
the workflow. They may be **scheduled** into a version but must **not** be
removed during scope-trimming.

- Runnable test command [framework-required] <!-- key: test-command -->
- Smoke/build command [framework-required] <!-- key: smoke-build-command -->
- Non-interactive launch path [framework-required] <!-- key: non-interactive-launch -->
- Visual-inspection CLI (headless screenshot / render-to-file / DOM-or-scene dump / automation endpoint) — see UX tier (`grm-design-language-adapt`, `grm-ux-demo-build`) [framework-required] <!-- key: gui-visual-inspection-cli, shape: GUI -->

---

## Issues

Issues are tracked in **GitHub** (`rhohn94/retro-game-player`, configured via the
`grm-issue-tracker` block in `.claude/grimoire-config.json`). The GitHub repo must
be created and pushed before issue operations resolve; until then this roadmap
is the canonical visible state. Manage trackers with `issue-tracker-switch list`.

---

## Conventions

- One `## vX.Y` section per planned release.
- Each entry has a **Theme** line (one sentence), a bullet list of deliverables,
  and explicit **Non-goals** to prevent scope creep.
- When a release plan is agreed, add a `Plan:` link pointing to
  `docs/release-planning-v{X.Y}.md`.
- When a release ships, update the entry to `(released — see version-history.md)`.
- Rows under `## Framework-required (baseline)` are tagged `[framework-required]`
  and are never dropped during scope-trimming.
