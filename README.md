# Harmony

A polished, Mac-native (Apple Silicon) **retro game player** built on
[Tauri 2](https://tauri.app/) + React + the [Aura](https://github.com/rhohn94/design-language)
design language. Harmony manages a local game library across **20 classic
consoles** (generations 1–6), fetches cover art and metadata, helps you
*find* games (links and previews — see the contract below), and **plays
games in-page**: NES titles boot inside the app with sound, via an embedded
EmulatorJS core or (opt-in) a natively-hosted libretro core, with an external
RetroArch launch as the fallback for every other system.

**Harmony ships no game content.** It scans folders you provide and imports
files you choose.

---

## Contents

- [What Harmony is](#what-harmony-is)
- [What it is not](#what-it-is-not)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Building from source](#building-from-source)
- [Setup and first use](#setup-and-first-use)
- [Feature overview](#feature-overview)
- [Distribution](#distribution)
- [License and attribution](#license-and-attribution)
- [Developer workflow](#developer-workflow)
- [Docs index](#docs-index)

---

## What Harmony is

Harmony is a library-first frontend with three ways to play, tried in order:

```
Your ROM files → Harmony (library + UI)
                     ↓
        1. Native core host (opt-in) — fceumm NES hosted directly in
           Harmony's Rust backend, CoreAudio output          [v0.21]
        2. In-page EmulatorJS — NES boots inside the detail
           screen, with sound, from a loopback origin        [v0.15]
        3. External RetroArch launch — every other system    [v0.1]
```

It is a **Tauri 2 / Rust + React / TypeScript** application for macOS Apple
Silicon (arm64). The UI uses the **Aura** design language (3-knob OKLCH
theming, translucent shelves) with native `NSVisualEffectView` window
vibrancy — not CSS `backdrop-filter`. Cover-art blurs are pre-computed in
Rust. The whole UI is navigable by controller alone (Xbox · PlayStation ·
8BitDo · Switch Pro).

**Consoles:** 20 home consoles of generations 1–6 (NES, SNES, N64, Genesis,
PlayStation, Saturn, Dreamcast, and more), each with curated libretro cores
verified against the live arm64 buildbot.

---

## What it is not

- **Not a game store.** Harmony never bundles or distributes game content.
- **Not a ROM downloader.** Search previews what your configured providers
  list and opens your chosen link in **your browser** — Harmony itself
  downloads no content files. (An optional, strictly per-provider, off-by-
  default direct-download feature is planned — see the roadmap.)
- **Not only an emulator.** Emulation is performed by libretro cores —
  embedded (EmulatorJS/WASM), natively hosted (v0.21, NES), or via RetroArch.

---

## Quick start

```bash
# 1. Clone with the Aura submodule
git clone --recurse-submodules https://github.com/rhohn94/harmony.git
cd harmony

# 2. Install dependencies
pnpm install

# 3. Run in development mode
pnpm tauri dev
```

On first launch, add a content folder under **Settings → Folders** (or let
Harmony create a games directory for you from the empty-library prompt), then
drop ROM files in — or import them by drag-and-drop onto the window.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **macOS (Apple Silicon)** | arm64 only; Intel is not supported |
| **RetroArch** (optional) | Only needed for systems without an in-page core — [retroarch.com](https://www.retroarch.com/). Harmony locates it automatically or set the path in Settings. |
| **Rust** (stable, via [rustup](https://rustup.rs/)) | Tauri's backend (building from source) |
| **Node.js** >= 20 | Frontend toolchain (building from source) |
| **pnpm** | `npm install -g pnpm` |
| **Xcode Command Line Tools** | `xcode-select --install` |

### Aura submodule

Aura ships as a git submodule (`vendor/aura`). Initialize it after cloning:

```bash
git submodule update --init
```

---

## Building from source

```bash
pnpm tauri dev                                   # development (hot-reload)
pnpm tauri build                                 # production build
pnpm tauri build --target aarch64-apple-darwin   # Apple Silicon release DMG
pnpm typecheck && cargo check --manifest-path src-tauri/Cargo.toml   # type-check
pnpm lint && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings  # lint
pnpm test && cargo test --manifest-path src-tauri/Cargo.toml         # tests
```

All verification commands must pass cleanly before any branch is merged.

---

## Setup and first use

### 1. Add your games

**Settings → Folders** (or the empty-library prompt) points Harmony at your
ROM folders — it can create a managed games directory for you. Harmony walks
the folders, hashes each file (CRC32 / MD5), matches against
[No-Intro](https://www.no-intro.org/) DAT files for clean titles and dedupe,
and stores results in a local SQLite database. You can also **import** games
by drag-and-drop or the file picker; imports are copied into the managed
directory, hash-deduped, and enriched (cover art + Wikipedia description)
automatically. Harmony never modifies your ROM files.

### 2. Play

Open a game. NES titles **auto-boot in-page with sound** — that boot screen
is part of the retro vibe. The overlay (Escape, the controller menu button)
offers Resume / Full screen / Exit. Other systems launch through RetroArch;
install it and the right cores under **Cores** if you want those systems.
An opt-in **Settings → Playback** toggle hosts NES natively in Harmony's
backend (cleaner audio, faster boot), falling back to the in-page core
automatically if it can't start.

### 3. Cores (for the RetroArch path)

**Cores** browses, searches, installs, and updates arm64 cores from the
[libretro buildbot](https://buildbot.libretro.com/), stored under
`~/Library/Application Support/com.harmony.app/cores/`.

### 4. Browse by console

**Consoles** is a generation-grouped grid of all 20 systems — photos,
hardware specs (CPU/GPU/RAM), Wikipedia summaries, your games per console,
and each console's full known-title catalog (~28.6k titles).

### 5. Find games (search)

The **Search** screen queries your configured providers and **previews the
candidate links in-app** (with relevance ranking, Match badges, per-provider
grouping, filters, and optional link-liveness dots). Add providers from the
curated **Browse providers** catalog or author your own URL template with
Detect-from-URL and a live validator. Harmony opens your chosen result in
your browser — it downloads nothing itself. Legality of any linked source is
your responsibility.

### 6. Controller navigation

Harmony is fully navigable by controller — focus states, button hints, grid
navigation, and in-game input. Default bindings cover Xbox, PlayStation,
8BitDo, and Switch Pro layouts. (A remapping UI is on the roadmap.)

### 7. Familiar AI enrichment (optional)

[Familiar](https://github.com/rhohn94/familiar) is an optional, locally-running
AI companion Harmony probes for at startup; if absent, all AI affordances are
hidden and everything else works normally. Deeper enrichment wiring is on the
roadmap.

---

## Feature overview

| Feature | Notes |
|---|---|
| Library scan + import | CRC32/MD5 hashing, No-Intro DAT matching, drag-drop import with hash dedupe, SQLite |
| In-page play | NES auto-boots with sound in the detail screen (EmulatorJS, loopback origin); overlay + immersive fullscreen |
| Native core host (opt-in) | fceumm NES hosted in the Rust backend, CoreAudio output, automatic fallback |
| RetroArch launch | Fallback path for systems without an in-page core |
| Console browse | 20 consoles, gen-grouped, specs + photos + full title catalogs |
| Core management | Browse/search/install/update arm64 cores from the libretro buildbot |
| Metadata & art | libretro-thumbnails box art, Wikipedia descriptions, auto-enrich on import |
| Search | Provider previews in-app, relevance ranking + Match badges, dedupe by game, liveness dots, curated provider catalog |
| Controller-first UI | Full navigation + in-game input; Xbox / PS / 8BitDo / Switch Pro |
| Native vibrancy | `NSVisualEffectView` window blur + Rust pre-blurred hero backdrops |
| Fleet identity | Ensign instance ID + version manifest; Mission Control compatible |

---

## Distribution

Harmony is distributed as a **Developer-ID DMG** for Apple Silicon Macs
(notarization is on the roadmap). It is not on the Mac App Store — the
`macOSPrivateApi: true` flag required for native vibrancy is incompatible
with App Store sandboxing.

GitHub Releases are cut from `main` after the integration master merges and
tags a version.

---

## License and attribution

Harmony is licensed under **GPL-3.0** (see [LICENSE](LICENSE)) — the natural
choice for a distributable that bundles **EmulatorJS** (GPL-3.0) and the
**fceumm** NES core (GPL-2.0-or-later). Bundled third-party software and
licenses are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md); the
full GPL-3.0 text is in [licenses/GPL-3.0.txt](licenses/GPL-3.0.txt).

---

## Developer workflow

Harmony uses the [Grimoire](https://github.com/rhohn94/grimoire) agentic
workflow framework with the **Noir** (autonomous) work paradigm.

### Branch model

```
main          <- stable releases only; tagged vX.Y.Z
dev           <- integration target
version/X.Y   <- staging branch per release (locked scope)
work/wNN-*    <- task-agent feature branches (merge into version/X.Y)
```

Work-item agents commit on isolated worktree branches. An **integration
master** merges all feature branches into `version/X.Y`, then promotes to
`dev` and `main`. **Push to origin is human-gated** — agents never push.
Force-push, rebase, and history rewriting are prohibited on protected
branches by guard hooks; use branch-and-merge and `git revert`.

### Release planning

Release scope is agreed as `docs/release-planning/release-planning-vX.Y.md`.
See [docs/roadmap.md](docs/roadmap.md) for the roadmap and
[CLAUDE.md](CLAUDE.md) for the full project-commands table and workflow guide.

---

## Docs index

| Document | What it covers |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | Shipped releases + the planned v0.23+ arc |
| [docs/version-history.md](docs/version-history.md) | One-line-per-release changelog |
| [docs/design/architecture-design.md](docs/design/architecture-design.md) | Master architecture contract |
| [docs/design/harmony-ux-design.md](docs/design/harmony-ux-design.md) | Screen layout, hero backdrop, motion |
| [docs/design/in-page-play-design.md](docs/design/in-page-play-design.md) | Embedded EmulatorJS player, overlay, loopback origin |
| [docs/design/native-emulation-design.md](docs/design/native-emulation-design.md) | Native libretro core hosting (v0.21) + attract mode |
| [docs/design/save-persistence-design.md](docs/design/save-persistence-design.md) | Save states + SRAM (v0.23) |
| [docs/design/direct-download-design.md](docs/design/direct-download-design.md) | Per-vendor direct download (planned, v0.24) |
| [docs/design/console-browse-design.md](docs/design/console-browse-design.md) | By-console grid + title catalogs |
| [docs/design/download-browsing-ux-design.md](docs/design/download-browsing-ux-design.md) | Search preview/browse UX |
| [docs/design/provider-discovery-design.md](docs/design/provider-discovery-design.md) | Curated provider catalog |
| [docs/design/controller-input-design.md](docs/design/controller-input-design.md) | Controller bindings + spatial navigation |
| [docs/coding-standards.md](docs/coding-standards.md) | Cross-language coding standards |
| [docs/architecture-guidelines.md](docs/architecture-guidelines.md) | Architectural principles |
| [CLAUDE.md](CLAUDE.md) | Grimoire agent guide + project commands |
