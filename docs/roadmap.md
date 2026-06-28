# Roadmap

> **Up:** [↑ Docs](README.md)

Harmony is a polished, Mac-native (Apple Silicon) emulator **frontend**: a
launcher that manages libretro cores and a local game library with cover art and
metadata, and runs content by orchestrating RetroArch. It ships **no** game
content — it scans folders the user provides. One `## vX.Y` section per planned
release; the integration master uses this file as the primary input to
`grm-release-planning`.

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

## v0.3 – v0.7 — Full GUI & emulator cores (provisional)

**Theme:** With the app visible, complete and verify the GUI and the
discover → download → configure → launch core lifecycle. Each release is
re-planned against the working app.

- **v0.3 — Library & shell:** real library grid, hero, navigation shell, game
  detail — verified rendering with mock data.
- **v0.4 — Core discovery & download:** cores screen, buildbot catalog, the
  download → verify → install flow, per-system active-core selection — end-to-end.
- **v0.5 — Scan & identification:** content-folder config, scan trigger +
  progress, No-Intro matching results, unmatched-ROM handling.
- **v0.6 — Launch & settings:** RetroArch locate/picker, launch flow, and the
  full settings surface (folders, cores, controllers, search, RetroArch path).
- **v0.7 — Controller & art:** spatial controller navigation + hints, box
  art/thumbnail fetch + caching with graceful fallbacks, full controller
  operability.

Plan: *(planned per release after v0.2)*

---

## Backlog

Deferred until after the GUI-and-cores program (v0.2–v0.7):

- **Enrichment & polish** (was v0.2): optional ScreenScraper support
  (user-supplied API key); optional AI-assisted enrichment (fuzzy title
  matching, ambiguous-dump disambiguation) via **Familiar**'s OpenAI-compatible
  API as a soft, capability-discovered dependency; refined controller-binding
  configuration UI and more art fallbacks.
- **Beyond the core three** (was v0.3): additional systems beyond NES / SNES /
  N64; collections, favorites, play-time tracking, and richer filtering.
- **Notarized DMG** (T2): signed + notarized arm64 DMG for distribution.

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

Issues are tracked in **GitHub** (`rhohn94/harmony`, configured via the
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
