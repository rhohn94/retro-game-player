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

## v0.2 — Enrichment & polish

**Theme:** Richer metadata, smarter matching, and a more refined experience.

- Optional ScreenScraper support (user-supplied API key).
- Optional AI-assisted enrichment (fuzzy title matching, ambiguous-dump
  disambiguation) via **Familiar**'s OpenAI-compatible API — a **soft**
  dependency detected through its capability-discovery endpoint; Harmony works
  fully with Familiar absent.
- Refined controller-binding configuration UI and more art fallbacks.

Plan: *(not yet planned)*

---

## v0.3 — Beyond the core three

**Theme:** Broaden system coverage and library power-tools.

- Additional systems beyond NES / SNES / N64.
- Collections, favorites, play-time tracking, and richer filtering.

Plan: *(not yet planned)*

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
