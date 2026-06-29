# Harmony

A polished, Mac-native (Apple Silicon) emulator **frontend and launcher** built on
[Tauri 2](https://tauri.app/) + React + the [Aura](https://github.com/rhohn94/design-language)
design language. Harmony manages a local game library and libretro cores, fetches
cover art and metadata, and runs games by orchestrating **RetroArch** — it does not
contain any emulation code of its own.

**Harmony ships no game content.** It scans folders you provide.

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

Harmony is the frontend layer of a classic Mac emulation stack:

```
Your ROM files  →  Harmony (library + UI)
                       ↓
                   RetroArch  (launched by Harmony)
                       ↓
                   libretro core  (managed by Harmony)
                       ↓
                   Emulated game
```

It is a **Tauri 2 / Rust + React / TypeScript** application that runs natively on
macOS Apple Silicon (arm64). The UI uses the **Aura** design language (a git
submodule pin of `rhohn94/design-language`) for 3-knob OKLCH theming and
translucent shelves, with native `NSVisualEffectView` window vibrancy — not CSS
`backdrop-filter` (which is broken in transparent WKWebView). Cover-art blurs are
pre-computed in Rust and handed off to the React layer.

**v0.1 supports:** NES · SNES · Nintendo 64.

**v0.1 controllers:** Xbox · PlayStation · 8BitDo · Switch Pro (full
controller-first navigation — no mouse required).

---

## What it is not

- **Not an emulator.** Harmony contains no emulation code. All emulation is
  performed by RetroArch + the libretro cores it manages.
- **Not a game store.** Harmony never downloads, bundles, or distributes game
  content of any kind.
- **Not a ROM downloader.** The file-search feature constructs and opens links
  in your browser — it never fetches files for you.

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

On first launch, open **Settings → RetroArch** and point Harmony at your
RetroArch installation. Then add a content folder under **Settings → Library**.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **macOS (Apple Silicon)** | arm64 only; Intel is not supported in v0.1 |
| **RetroArch** | Install separately — [retroarch.com](https://www.retroarch.com/). Harmony locates it automatically or you can set the path in Settings. |
| **Rust** (stable, via [rustup](https://rustup.rs/)) | Tauri's backend |
| **Node.js** >= 20 | Frontend toolchain |
| **pnpm** | `npm install -g pnpm` |
| **Xcode Command Line Tools** | `xcode-select --install` |

### Aura submodule

Aura ships as a git submodule (`vendor/aura`). Initialize it after cloning:

```bash
git submodule update --init
```

If you cloned with `--recurse-submodules` this is already done.

---

## Building from source

```bash
# Development (hot-reload)
pnpm tauri dev

# Production build (universal macOS app)
pnpm tauri build

# Apple Silicon release DMG
pnpm tauri build --target aarch64-apple-darwin

# Type-check
pnpm typecheck && cargo check --manifest-path src-tauri/Cargo.toml

# Lint
pnpm lint && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# Tests
pnpm test && cargo test --manifest-path src-tauri/Cargo.toml
```

All three verification commands (typecheck, lint, test) must pass cleanly before
any branch is merged.

---

## Setup and first use

### 1. Point Harmony at RetroArch

Open **Settings → RetroArch**. Harmony probes common installation paths
(`/Applications/RetroArch.app`, `~/Applications/RetroArch.app`) automatically.
If it does not find RetroArch, click **Browse** and select the `.app` bundle.

### 2. Install cores

Go to **Cores** and install the cores for the systems you want. Cores are
arm64 `.dylib` files downloaded from the
[libretro buildbot](https://buildbot.libretro.com/) and stored under
`~/Library/Application Support/com.harmony.app/cores/`.

| System | Recommended cores |
|---|---|
| NES | Mesen, FCEUmm |
| SNES | Snes9x, bsnes |
| N64 | Mupen64Plus-Next |

### 3. Add content folders

Go to **Settings → Library** and add the folders that contain your ROM files.
Harmony walks the folders, hashes each file (CRC32 / MD5), and matches against
[No-Intro](https://www.no-intro.org/) DAT files to produce clean titles and
remove duplicates. Results are stored in a local SQLite database.

Harmony never modifies your ROM files.

### 4. Box art

Box art is fetched from the free
[libretro-thumbnails](https://github.com/libretro-thumbnails) repositories using
the No-Intro name. Images are cached locally under
`~/Library/Application Support/com.harmony.app/art-cache/`. No account or API
key is required.

### 5. File search providers (optional)

The **Search** screen lets you configure URL-template providers for finding
files. Go to **Settings → Search Providers** and add a provider with a
`{query}` placeholder in the URL. Harmony substitutes your search term
(percent-encoded) and opens the resulting link in your browser.

**Harmony ships with an empty provider list and never auto-downloads anything.**
It returns links only; you decide what to open.

### 6. Controller navigation

Harmony is designed to be navigated entirely by controller. Focus states,
button hints, and grid navigation all work without a mouse. Default bindings
cover Xbox, PlayStation, 8BitDo, and Switch Pro layouts, stored in the local
SQLite database. Remap actions in **Settings → Controller**.

### 7. Familiar AI enrichment (optional, v0.2+)

[Familiar](https://github.com/rhohn94/familiar) is an optional, locally-running
AI companion that enriches library metadata — fuzzy title matching, ambiguous
dump disambiguation. It is a **soft dependency**: Harmony probes for it at
startup and works fully without it. If Familiar is absent or unauthorized,
AI affordances are hidden and all other features continue normally.

Familiar integration is planned for v0.2.

---

## Feature overview

| Feature | Notes |
|---|---|
| Library scan | CRC32 / MD5 hash, No-Intro DAT matching, SQLite persistence |
| Core management | Download / update arm64 cores from the libretro buildbot |
| Game launch | Shells out to RetroArch with the correct core + content path |
| Box art | Fetched from libretro-thumbnails; cached locally |
| Native vibrancy | `NSVisualEffectView` window blur + Rust pre-blurred hero backdrop |
| Controller input | Full grid/menu navigation; Xbox / PS / 8BitDo / Switch Pro |
| File search | User-configured URL-template providers; links only, never downloads |
| Fleet identity | Ensign instance ID + version manifest; compatible with Mission Control |
| Familiar enrichment | Soft dependency — silently absent if not installed (v0.2 target) |

---

## Distribution

Harmony is distributed as a **notarized Developer-ID DMG** for Apple Silicon
Macs. It is not available on the Mac App Store — the `macOSPrivateApi: true`
Tauri flag required for native vibrancy is incompatible with App Store
sandboxing.

GitHub Releases are cut from the `main` branch after the integration master
merges and tags a version. See [docs/version-design.md](docs/version-design.md).

---

## License and attribution

Harmony's in-page player bundles **EmulatorJS** (GPL-3.0) and the **fceumm**
NES core into the distributable. Bundled third-party software, its licenses, and
pointers to corresponding source are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md); the full GPL-3.0 text is in
[licenses/GPL-3.0.txt](licenses/GPL-3.0.txt). Harmony's own code has no declared
license yet (see the open question in the notices file).

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

Force-push, rebase, and history-rewriting commands are prohibited on
`dev` / `main` / `version/*` by the `protected-branch-guard.sh` hook.
Use `git switch -c <branch> <ref>` + `git merge --no-ff` and
`git revert` to undo landed commits.

### Key commands

```bash
pnpm tauri dev                              # run with hot-reload
pnpm tauri build                            # production build
pnpm test && cargo test ...                 # full test suite
pnpm typecheck && cargo check ...           # type-check both halves
pnpm lint && cargo clippy ...               # lint both halves
```

See [CLAUDE.md](CLAUDE.md) for the full project-commands table and the
Grimoire workflow guide.

### Release planning

Release scope is agreed as a `docs/release-planning-vX.Y.md` document.
See [docs/roadmap.md](docs/roadmap.md) for the feature roadmap and
[docs/integration-workflow.md](docs/integration-workflow.md) for the
integration-master pipeline.

---

## Docs index

| Document | What it covers |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | Feature roadmap (v0.1, v0.2, v0.3) |
| [docs/design/architecture-design.md](docs/design/architecture-design.md) | Master architecture contract — module map, IPC surface, SQLite schema, directory layouts |
| [docs/design/native-vibrancy-design.md](docs/design/native-vibrancy-design.md) | NSVisualEffectView seam + Rust pre-blur pipeline |
| [docs/design/ux/design-language.md](docs/design/ux/design-language.md) | Aura submodule wiring, 3-knob OKLCH theming |
| [docs/design/harmony-ux-design.md](docs/design/harmony-ux-design.md) | Screen layout, hero backdrop, Framer Motion choreography |
| [docs/design/core-management-design.md](docs/design/core-management-design.md) | Libretro buildbot client, arm64 core install |
| [docs/design/library-identification-design.md](docs/design/library-identification-design.md) | ROM scanner, hashing, No-Intro DAT matching |
| [docs/design/emulation-launch-design.md](docs/design/emulation-launch-design.md) | RetroArch locate + launch |
| [docs/design/metadata-art-design.md](docs/design/metadata-art-design.md) | libretro-thumbnails fetch + art cache |
| [docs/design/file-search-design.md](docs/design/file-search-design.md) | URL-template search providers |
| [docs/design/controller-input-design.md](docs/design/controller-input-design.md) | Controller bindings + spatial navigation |
| [docs/design/familiar-enrichment-design.md](docs/design/familiar-enrichment-design.md) | Optional AI enrichment via Familiar |
| [docs/design/fleet-ensign-design.md](docs/design/fleet-ensign-design.md) | Fleet identity + localhost status endpoint |
| [docs/coding-standards.md](docs/coding-standards.md) | Cross-language coding standards |
| [docs/architecture-guidelines.md](docs/architecture-guidelines.md) | Architectural principles |
| [docs/integration-workflow.md](docs/integration-workflow.md) | Integration-master pipeline |
| [docs/version-design.md](docs/version-design.md) | Versioning conventions + release procedure |
| [CLAUDE.md](CLAUDE.md) | Grimoire agent guide + project commands |
