# Version History

> Shipped releases of **this project**, newest first. One section per tagged
> version, with bullets aimed at your users. Forward-looking plans live in
> `roadmap.md`. This file is **yours** — Grimoire seeds the empty template and
> never writes its own framework changelog here.

<!-- Add a new "## vX.Y — <title>" section per release, newest first. -->

## v0.31 — Frontier (2026-07-04)

Non-retro games join the library — the first slice of the universal-frontend
ambition (Horizon H1). Your Steam library, game-category apps, and anything
you add by hand now live on the same shelves, detail pages, and TV rails as
your ROMs, and launch with the same click.

- **Steam library scan.** One click in Settings → Game sources reads your
  local Steam install manifests (no network, no login) and adds every
  installed Steam game to the library, with box art pulled from Steam's
  public CDN. Re-scans update rather than duplicate.
- **App scan with a confirm gate.** RGP shortlists game-category apps from
  `/Applications` and adds only what you approve — no library flooding. App
  entries get their bundle icon as art.
- **Manual entries.** A name plus an app or executable is enough to put any
  game on the shelf.
- **One launch flow for everything.** A new launch-descriptor engine starts
  Steam titles via `steam://`, apps via `open -a`, and custom executables
  directly — same detail page, same TV takeover, with play time tracked by
  watching the app's lifetime.
- **First-class non-retro UI.** A "Desktop" library filter and TV rail,
  source badges (Steam / App / Manual) in place of console badges, and
  detail pages that show "Launches via Steam / macOS" instead of
  emulator-only affordances.
- **Under the hood:** the games table now supports ROM-less rows (nullable
  ROM identity + a JSON launch descriptor, guarded by a DB CHECK
  invariant), and a latent migration-runner bug that could have dropped
  cached art during table rebuilds was found and fixed.
- **Docs hygiene** (#41): repo-rename remnants (`harmony` URLs) cleaned up,
  duplicated spike doc deduplicated, release-planning layout documented.

## v0.30 — Passport (2026-07-04)

Ready for hands that aren't the developer's — the first steps toward a
Gatekeeper-clean install for anyone, not just the dev machine.

- **Developer-ID signing + notarization plumbing.** The release build path
  now applies Developer-ID code signing, hardened runtime, and app
  entitlements, and wires Apple notarization + stapling into the release
  script, with an automated Gatekeeper (`spctl`) verification step. This
  release ships the wiring and documentation; a real signed/notarized DMG
  still requires a maintainer to supply an actual Apple Developer-ID
  certificate and notarization credentials (see
  `docs/design/notarization-distribution-design.md` for the full
  credential-setup story and honest gap list).

## v0.29.1 — Native NES flip-fix hotfix (2026-07-04)

Native NES gameplay renders right-side-up again.

- **Fixed upside-down native NES rendering.** v0.29's new WebGL2 CRT-filter
  renderer uploaded frames without compensating for the mismatch between the
  native core's top-down frame buffer and WebGL's texture-coordinate origin,
  so gameplay on the native play path rendered vertically flipped. The
  renderer now applies the correct GPU-side unpack orientation; every CRT
  preset (including Off) displays correctly.

## v0.29 — Craft (2026-07-03)

Authentic retro presentation and engineering depth — a configurable CRT
look, per-core tuning, a performance dashboard, and full keyboard
operability.

- **A state-of-the-art, highly configurable CRT filter.** Scanlines,
  screen curvature, color bleed, and a vignette, each independently
  adjustable, with four presets (Off, Classic CRT, Arcade Cabinet, Sharp)
  and a live before/after preview in Settings. Renders through a real
  WebGL shader on the native play path, and a close CSS-based
  approximation on the EmulatorJS path.
- **Per-core settings.** A new Settings → Core Options screen lists and
  lets you tune the active native-hosted core's own options, persisted
  across restarts.
- **An optional FPS counter and a performance dashboard.** Toggle a live
  FPS readout during play, and review recent session performance (frame
  timing, dropped frames, and more) from a new Settings → Performance
  panel.
- **Keyboard accessibility.** The entire app — including TV mode's system
  menu and the in-game menu — is now fully operable from a keyboard alone,
  with a visible focus indicator throughout.
- **Hardened test coverage** for both play paths and their IPC surface, so
  a broken player fails automated checks rather than surfacing only in
  manual play.

## v0.28 — Living Room (2026-07-03)

TV mode refined by a real couch playtest — the shelves fit right, every
screen is reachable, and the controller no longer fights the game you're
playing.

- **A smaller banner, tiles that are never chopped.** The hero band is
  shorter, and shelf tiles now size themselves to the screen so at least 5
  are always fully visible and never clipped top or bottom — shelves may
  draw over the lower edge of the banner instead of leaving a gap.
- **Every screen, from the couch.** Press Select (or the PlayStation
  touchpad) outside of gameplay to open a system menu — TV Home, Consoles,
  Search, Cores, and Settings are all one press away, rendered at 10-foot
  scale without leaving TV mode or fullscreen. Exiting TV mode always
  returns you to the screen you started from.
- **Start is yours again during gameplay.** A single Start press now reaches
  the game only — no more accidental menu pop-ups while playing. Open the
  in-game overlay with Start+Select together, or by holding Start alone for
  5 seconds (a small on-screen ring shows the hold building so you know it's
  about to open).

## v0.27.1 — EJS audio-warmup hotfix (2026-07-03)

Clean-sounding boots on the EmulatorJS path (every in-page system except
natively-hosted NES, plus the NES fallback).

- **No more garbled boot audio.** A fresh browser audio pipeline produces
  ~2–3 seconds of mangled sound on every EmulatorJS boot. The player now
  boots once silently behind a brief "Warming up…" cover to pay that
  cold-start cost, then resets the emulator and reveals — so the boot you
  see and hear replays clean from power-on, jingle intact (the
  boot-with-sound retro vibe is preserved, never faded or muted).
- Battery saves, the in-game overlay's pause, and your volume setting all
  compose correctly with the warmup (save wiring runs exactly once; a pause
  during the warm window defers the reveal; muted warmup wins over any
  volume, then your volume applies unchanged).
- Accepted trade-off: EmulatorJS boots take ~3 seconds longer, spent behind
  the cover. (Forward-ported from the historical `fix/audio-warmup` branch's
  final warm-then-reset approach.)

## v0.27 — Immersion (2026-07-03)

Playing a game in TV mode now actually feels like a console — driven end to
end by a real couch playtest.

- **True fullscreen play.** Launching a game from the TV shelves fills the
  screen edge-to-edge (letterboxed on pure black) instead of the small
  desktop player card, with in-game chrome at 10-foot scale. Desktop play is
  visually unchanged.
- **Controller input is properly scoped.** A running game owns the
  controller outright: no button can reach the home shelves underneath (the
  "pressing ✕ mid-game launched a different game" bug is structurally
  impossible now — ownership is a layered claim stack with no gaps, covering
  even boot, path-fallback, and get-core moments). The in-game overlay is
  now controller-drivable on the native path too, and holding Start mid-game
  no longer yanks you out of TV mode.
- **Hover-attract.** Rest on any NES tile for 5 seconds (controller focus or
  mouse hover) and the game boots as a live, dimmed, sound-ducked preview
  behind the shelves — pure attract-mode vibe. Previews are strictly
  no-trace: no play counts, no recency, no saves, ever; moving focus tears
  the preview down instantly and launching for real always boots fresh.
- **Native audio polish.** The resampler upgraded to 4-point Catmull-Rom
  with gentler rate control (addressing "mostly fine but slightly off"), the
  emulation thread runs at user-interactive priority, and each session now
  writes a readable perf log to `logs/native-perf.log` so timing health is
  verifiable after any playtest.
- **A full TV-mode gap audit** (25 contracts and seams) fixed eight more
  paper cuts: exiting an in-page game no longer drops the app out of
  fullscreen, keyboard users get focus back on the exact tile they launched
  from (and can actually play in-page games in the takeover), a pre-launch
  back-press can no longer leave TV mode one press from silently exiting, a
  backgrounded app can no longer boot an audible preview, play-path notices
  render at TV scale, and a one-frame Start-button leak on the native path
  is gone.

## v0.26.2 — Hotfix: images restored after the rename (2026-07-03)

Fixes "no images anywhere in the app" for users upgrading from Harmony. The
v0.26 rename moved your data folder, but 28 database records still pointed
at the old location with absolute paths — every console photo, box art, and
art-tier cache entry (and the installed-core paths on the Cores page)
dangled. A one-time database repair rewrites them to the new location on
first launch; your art files were always safe on disk.

## v0.26.1 — Hotfix: native-play A/V clock (2026-07-02)

Native play now runs at the game's true speed with clean audio. The first
v0.26 sessions confirmed native playback ran measurably slow and "sounded
off"; the causes were three compounding timing defects in the emulation
backend. The frame loop now paces on an absolute-deadline clock (sleep
overshoot is repaid instead of accumulating, so NES really runs at its
60.0988 fps), the core's audio is properly resampled to the output device's
rate with dynamic rate control locking the two clocks together (no more
wrong-pitch playback, gap crackle, or creeping audio lag), and the realtime
audio callback is lock- and allocation-free with an audio pre-fill at boot.
A perf line (effective fps, ring fill, underrun/overrun) logs every 10 s so
timing health is verifiable, not just audible.

## v0.26 — Theater (2026-07-02)

Harmony is now **Retro Game Player** — and it belongs in your living room.

- **The app has a new name.** Everything user-visible says Retro Game Player,
  and your existing library, saves, settings, and art move over automatically
  on first launch — nothing to re-import, nothing lost.
- **TV mode.** A full 10-foot leanback experience: press Cmd+T, use the
  sidebar button, or long-press your controller's menu button (or flip
  "Start in TV mode" in Settings → Appearance) and the whole app becomes a
  couch console — big type, TV-safe margins, and a home built from
  cover-art shelves (Continue playing, Favorites, Recently added, and one
  rail per console) under a full-bleed key-art hero that follows your focus.
- **Seamless in and out of games.** Selecting a game expands its cover art to
  fullscreen while the emulator boots underneath — sound on, boot screen and
  all — and exiting drops you back on the exact shelf spot you launched from.
- **Built for the controller.** Distance-legible focus (scaled, glowing,
  never clipped), shelves that snap the focused tile into view, hold-to-repeat
  navigation, and full support for Xbox, PS4 (DualShock 4), and PS5
  (DualSense) pads on macOS — with correct button glyphs per controller.
- **Remap your buttons.** Settings → Controllers is now a real press-to-rebind
  editor: pick an action, press a button, done — per controller family, with
  conflict handling and reset-to-defaults.
- **Your library remembers.** Favorites (a heart on any game), recently
  played, play counts, and total play time now persist across all three play
  paths — they power the TV shelves and stick across restarts.
- **Sharper art on big screens.** Cover, title, and in-game snapshot art now
  fetch and cache at full resolution, with full-bleed hero rendering on TV
  surfaces.

## v0.25.1 — Hotfix: Aura Dependency Channel migration (2026-07-02)

The Aura design-language runtime moves from a git submodule (v3.20) to a
verified Dependency Channel asset bundle (v3.541.0) — no more submodule
checkout step for a fresh clone. Fixes a packaging gap this migration
surfaced: the committed Aura runtime bundle (`vendor/aura/dist/`, the exact
file `vite.config.ts` aliases the app's Aura import to) was being silently
swallowed by a blanket `.gitignore` rule, which would have broken the build
on any fresh checkout. Also pulls in the latest Grimoire workflow tooling
(framework v3.63).

## v0.25 — Scout (2026-07-02)

Point Harmony at a site's home URL and it figures out how to search there.
**Provider API auto-discovery** probes a site for standard search interfaces —
an OpenSearch description, MediaWiki or WordPress APIs, or a plain HTML search
form — and fills the Add-provider form with a ready-to-use template, best
match first. Verified end-to-end: given only `en.wikipedia.org`, Harmony
recovers Wikipedia's OpenSearch search template on its own. The **provider
catalog** also grows with four live-verified legitimate sources — Lexaloffle
BBS (PICO-8 homebrew), OpenGameArt, TheGamesDB, and Hardcore Gaming 101.
Discovery only ever probes the site you name; it never crawls the open web.

## v0.24 — Everywhere (2026-07-02)

Every found game can land inside Harmony, and more of the catalog plays
in-page. **In-page cores for 7 more systems** (SNES, Genesis, Master System,
N64, PlayStation, Atari 2600, PC Engine): a one-click, hash-verified core
download unlocks the same auto-boot-with-sound player NES has — RetroArch
fallback untouched. **Direct download**: providers you explicitly opt in
carry a ⬇ action that streams your chosen file (capped, cancellable, staged)
through the import pipeline to a "✓ In library — Play" link; every provider
ships with it off. **Player conveniences**: persisted volume + mute in the
overlay on both paths, rewind/fast-forward on the EmulatorJS path, and
pause-when-Harmony-loses-focus (Settings toggle, default on). Native NES
play is now **on by default** (audio + smoothness confirmed on-device), and
the boot-latency spike (#14) closed with a go/no-go record (follow-up #31).

## v0.23.1 — Hotfix: native-play frame delivery (2026-07-01)

Smooth native gameplay. The first real play sessions after v0.23's crash fix
exposed the v0.21 frame pipeline (base64-in-JSON per frame, per-byte JS
decode) as a heavy stutter source. Frames now cross the IPC boundary as raw
binary with zero-copy painting, and unchanged frames cost a near-empty
round trip.

## v0.23 — Continuity (2026-07-01)

Progress is never lost, and the player never lies. Battery/SRAM saves and
4-slot save states on both play paths (natively-hosted core + EmulatorJS),
persisted to one shared on-disk layout with an exit auto-save and a
"Continue" affordance. The v0.21 native-play crash was root-caused (libretro
callback-ordering contract) and fixed with real-device verification.
Play-path fallbacks now show a dismissible explanation instead of degrading
silently. **Attract mode:** scrolling down the game detail page hands the
live native gameplay to a dimmed full-bleed page background (input detached,
audio ducked) and reattaches on scroll-up. Harmony is now licensed GPL-3.0;
the GPL-incompatible UnRAR blob no longer ships; README and this file tell
the truth.

## v0.22 — Polish (2026-06-30)

Code-quality and UX consistency pass; no new features. Fixed a search-thread
panic that could crash a whole search and a lingering controller focus ring;
extracted a shared cancellable-effect hook; split the oversized Search and
Settings pages; cleaned up IPC-boundary leaks; unified empty/error/loading
states across Search/Cores to match Library/Consoles.

## v0.21 — Bedrock (2026-06-30)

Native NES emulation: Harmony hosts the `fceumm` libretro core directly in the
Rust backend (hand-rolled FFI) with CoreAudio output — eliminating the Web
Audio cold-start garble — behind an off-by-default Playback toggle with
automatic EmulatorJS fallback. NES-only proof; frame delivery to canvas via
IPC; keyboard/gamepad input reuses the existing bindings.

## v0.20 — Atlas (2026-06-29)

First-class add-provider experience: a curated, searchable "Browse providers"
catalog of vetted legitimate sources with one-click add; guided provider
authoring with inline help, a reference/download type selector, Detect-from-URL
template derivation, and a live "Test provider" validator.

## v0.19 — Reach (2026-06-29)

Cross-provider dedupe ("By game" view merging the same title across providers),
opt-in link-liveness checking (HEAD probes with alive/dead/unknown dots), seven
new vetted server-rendered providers (Steam, PDRoms, Demozoo, Pouët, Lemon
Amiga, Zophar's Domain, ROMhacking.net), and honest contract wording.

## v0.18 — Focus (2026-06-29)

Relevant results: junk-link filtering at the scrape, relevance ranking with
Match/Partial badges (Relevance is the new default sort), structured console +
region search fields, and per-provider query composition.

## v0.17 — Sift (2026-06-29)

Browsable search preview: collapsible provider groups, live result filter,
persisted sort, multi-select with batch open-in-browser, and title-parsed
badges (region, revision, dump quality, file type).

## v0.16 — Trove (2026-06-28)

In-app result preview: search fetches each provider's public results page and
previews the candidate links in Harmony (with strict fetch safeguards) — the
user still opens their chosen link in the browser. Scaffolded the per-vendor
direct-download capability flag (off everywhere). Added third-party GPL
attribution (THIRD-PARTY-NOTICES.md).

## v0.15 — Arcade (2026-06-28)

In-page play: NES titles auto-boot with sound inside the detail screen via an
embedded EmulatorJS core served from a loopback origin; in-game overlay
(Resume / Full screen / Exit) and window-fullscreen immersive mode; systems
without a bundled core fall back to the external RetroArch launch.

## v0.14 — Lounge (2026-06-28)

Couch foundations: controller navigation wired to the shell (spatial focus for
sidebar + library tiles), F11/sidebar window fullscreen, and CPU/GPU/RAM
hardware-spec tables on every console detail page.

## v0.13 — Reveal (2026-06-28)

Enabled Tauri's asset protocol (narrowly scoped) so cached cover art and
console photos actually render — a user-reported fix.

## v0.12 — Curator (2026-06-28)

Library curation: drag-and-drop / file-picker ROM import into the managed
Games directory with hash dedupe; automatic cover art + Wikipedia description
on add; a By-Console browse (generation-grouped grid, console photos and
specs, and each console's full ~28.6k-title known catalog); curated ROM-site
download providers (links-only).

## v0.11 — Quarry (2026-06-28)

Download search: providers gain a reference/download kind; seeded two legal
links-only download homes (Internet Archive, itch.io); "Find downloads" on the
game detail page pre-fills and auto-runs a search.

## v0.10 — Lineage (2026-06-28)

Console catalog expanded from NES/SNES/N64 to 20 generation-1–6 home consoles,
every core verified against the live libretro arm64 buildbot; scanner gains
the unambiguous ROM extensions for the new systems.

## v0.9 — Contact (2026-06-28)

Repaired the entire Aura interaction layer: 17 controls were wired against an
imagined API (dead buttons, untypeable fields, broken selects) — all rewired to
real events, with a static guard and a real-input Playwright gate so it can't
regress.

## v0.8 — Confirm (2026-06-27)

The "Create a games folder" flow now confirms success with the created path
and a Reveal-in-Finder button instead of closing silently.

## v0.7 — Forge (2026-06-27)

Core discovery: broadened the curated core catalog (multiple cores per
system) and added browse + search to the Cores screen on the existing real
download/verify/install pipeline.

## v0.6 — Lens (2026-06-27)

Built-in reference search providers (MobyGames, IGDB, Wikipedia, GameFAQs) and
multi-facet library filtering (console pills, title/alias search,
year/developer/publisher facets that hide when empty).

## v0.5 — Threshold (2026-06-27)

One-click "Create a games folder" from the empty library and Settings, with
safety guards, persistence, and an automatic rescan chain.

## v0.4 — Motion (2026-06-27)

A single motion source for all animation (Framer presets + CSS tokens): route
crossfades, grid stagger, dialog pop — honoring reduced-motion centrally, with
a guard against raw motion literals.

## v0.3 — Resonance (2026-06-27)

Full Aura design-token adoption: a `--harmony-*` token layer, all screens
token-driven, colour-literal fallbacks stripped, with a token-adoption build
guard.

## v0.2 — Sight (2026-06-27)

Made the app render (fixed the Aura runtime init-order crash and the inverted
CSS cascade-layer order that shipped v0.1 blank) and made the GUI
self-verifying: the headless inspection now asserts every route mounts and
fails the build on a blank or crashed UI.

## v0.1 — Foundation (2026-06-26)

The full native shell: Tauri 2 + React + Aura with native vibrancy; library
scanning (CRC32/MD5 + No-Intro DAT matching, SQLite); libretro core management
from the buildbot; RetroArch launch; controller-first navigation; box art from
libretro-thumbnails; URL-template file search (links only); fleet identity and
telemetry. Shipped with a blank-screen defect fixed in v0.2.
