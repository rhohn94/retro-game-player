# Release Planning — v0.1

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.1.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.1` |
| **Previous** | — (greenfield; first release) |
| **Theme** | "Foundation" — a runnable, beautiful, Mac-native (Apple Silicon) emulator *frontend*: native Tauri+React+Aura shell with NSVisualEffectView vibrancy, a scanned/identified SQLite library with cover art, libretro core management + RetroArch launch for NES/SNES/N64, full controller-only navigation, source-agnostic file search, fleet identity + telemetry, and a cut GitHub Release. |

Grounded in eight ecosystem research briefs (Aura, Dream/Aura-in-React,
Familiar, Fleet/Ensign, dependency channel, Tauri vibrancy, libretro/RetroArch,
controllers). Architecture decisions approved by the user; Aura consumed via a
git-submodule pin to the official `bindings/react`; Fleet ships both the static
manifest and a localhost endpoint; distribution is a notarized Developer-ID DMG
(not Mac App Store).

---

## 2. Major Features

### Phase D — Design contracts

#### D1 — Architecture + IPC/DB contract
- **Description:** The master design doc: module map (frontend `src/`, backend `src-tauri/src/`), the complete Tauri `invoke` command surface (names + arg/return shapes), the SQLite schema (library, cores, settings, controllers, providers, art-cache), app-support path layout, and the two-seam overview.
- **Acceptance:** `docs/design/architecture-design.md` exists in house layout; lists every `invoke` command and its TS↔Rust signature; defines the SQLite schema; defines the app-support + deployed-instance directory layouts; cross-links D2/D3 and every feature doc.
- **Branch:** `work/d1-architecture` · **Design doc:** `docs/design/architecture-design.md`

#### D2 — Native-vibrancy seam
- **Description:** Specifies the vibrancy↔web seam: `tauri.conf.json` (`macOSPrivateApi`, `transparent`, `windowEffects` sidebar material + radius, `titleBarStyle: Overlay`, `hiddenTitle`), transparent webview CSS contract, the Rust pre-blurred-hero handoff, and the no-`backdrop-filter` rule.
- **Acceptance:** `docs/design/native-vibrancy-design.md` documents exact config keys, the CSS transparency contract, the Rust `image`-crate pre-blur + cache flow, traffic-light/drag-region handling, and the App-Store/entitlements implications.
- **Branch:** `work/d2-vibrancy` · **Design doc:** `docs/design/native-vibrancy-design.md`

#### D3 — Aura-in-React UX adaptation
- **Description:** Run `design-language-adapt` to produce `docs/design/ux/design-language.md`; specify submodule vendoring of `design-language`, `bindings/react` consumption, 3-knob OKLCH theming wiring, anti-FOUC, and the Aura archetype→Harmony-screen mapping. Converge with Dream's intended direction.
- **Acceptance:** `docs/design/ux/design-language.md` records the pinned Aura SHA + submodule path + brand-knob values + archetype map; a `harmony-ux-design.md` captures the screen inventory; the Aura-in-React friction findings are noted.
- **Branch:** `work/d3-aura-ux` · **Design doc:** `docs/design/ux/design-language.md`, `docs/design/harmony-ux-design.md`

### Phase 0 — Scaffold

#### W1 — App scaffold + window/vibrancy + IPC + recipe + smoke
- **Description:** Scaffold the Tauri 2 + React 19 + TS + Vite app (`package.json` v0.1.0, `src/`, `src-tauri/`); apply the D2 window/vibrancy config; establish the typed IPC plumbing (`src/ipc/`, `src-tauri/src/commands/mod.rs` registration pattern); wire `.claude/recipes.json` (`build`/`server`/`test`/`lint`/`smoke`); add a smoke harness.
- **Acceptance:** `recipe.py build` and `recipe.py test` exit 0; `pnpm tauri dev` launches a transparent-vibrancy window; a trivial `invoke` round-trips; `recipe.py smoke` exists and passes; `tsc --noEmit` + `cargo check` clean.
- **Branch:** `work/w1-scaffold` · **Design doc:** D1 (extends)

#### W2 — Aura integration
- **Description:** Add `design-language` as a git submodule pinned per D3; import `@aura-design/core/style` + runtime + `bindings/react`; wire 3-knob theming + dark default + named-theme select; anti-FOUC head script; base `AuraApp` shell + routing.
- **Acceptance:** App renders on the Aura app-shell archetype with vibrancy showing through transparent shelves; theme persists; no FOUC; uses `events`/`class` (not `onChange`/`className`); typed wrappers compile.
- **Branch:** `work/w2-aura` · **Design doc:** D3 (impl)

#### W3 — SQLite persistence layer
- **Description:** SQLite (rusqlite or sqlx) with migrations; repos for library (games/folders), cores (installed/active), settings, controller bindings, search providers, art cache; DB lives in app-support dir.
- **Acceptance:** Migrations apply idempotently; each repo has CRUD + unit tests; schema matches D1; DB path resolves under app-support.
- **Branch:** `work/w3-sqlite` · **Design doc:** `docs/design/persistence-design.md`

#### W4 — Config, paths, errors, telemetry
- **Description:** App config model; macOS app-support + deployed-instance path resolution; unified error type; `run.json` telemetry writer per the deployed-apps convention.
- **Acceptance:** Path helpers resolve `~/Library/Application Support/...` and the deployed `versions/current` root; error type unit-tested; `run.json` written on run with the documented fields.
- **Branch:** `work/w4-infra` · **Design doc:** `docs/design/app-infrastructure-design.md`

### Phase 1 — Rust backends

#### W5 — Core management
- **Description:** libretro buildbot arm64 client (`/nightly/apple/osx/arm64/latest/<core>_libretro.dylib.zip`); curated system→core map (NES: mesen/fceumm; SNES: snes9x/bsnes; N64: mupen64plus_next); download+unzip+`lipo` arm64 verify; install/update (Last-Modified)/select-active; store under app-support; `invoke` commands.
- **Acceptance:** Can list available + install + update + set-active a core for each system; rejects non-arm64 dylibs; persists installed/active in SQLite; unit tests for the map + arch check.
- **Branch:** `work/w5-cores` · **Design doc:** `docs/design/core-management-design.md`

#### W6 — Library scan & identify
- **Description:** Folder config; recursive walker; CRC32 + MD5 hashing (strip iNES headers before hashing); No-Intro Logiqx-XML DAT parser + CRC/SHA1 index; matcher → clean name; file→system→core mapping by extension/DAT; persist; surface unidentified ROMs.
- **Acceptance:** Scanning a folder of test ROMs hashes, matches against a DAT, yields clean names, dedupes, maps system+core, and persists; unidentified items flagged; DAT parser + matcher unit-tested.
- **Branch:** `work/w6-library` · **Design doc:** `docs/design/library-identification-design.md`

#### W7 — RetroArch launch
- **Description:** Locate RetroArch (`/Applications` + `~/Applications` + Launch Services `org.libretro.RetroArch`); arg builder (`-L <core> <rom>`, optional `-f`); `std::process::Command` shell-out with separate args; error if RetroArch absent.
- **Acceptance:** Launches a game with the active core via RetroArch; missing-RetroArch yields a clear "Install RetroArch" error + manual picker; arg builder unit-tested (spaces safe, always passes content).
- **Branch:** `work/w7-launch` · **Design doc:** `docs/design/emulation-launch-design.md`

#### W8 — Metadata & art
- **Description:** libretro-thumbnails CDN client (`thumbnails.libretro.com/<System>/Named_Boxarts/<Game>.png`); No-Intro name sanitizer (char substitution + URL-encode) + short-name fallback + Named_Titles/Named_Snaps fallback; on-disk cache; graceful placeholder.
- **Acceptance:** Fetches + caches boxart for an identified game; applies the 3-tier fallback; sanitizer unit-tested against No-Intro names; placeholder served on miss.
- **Branch:** `work/w8-metadata` · **Design doc:** `docs/design/metadata-art-design.md`

#### W9 — File-search providers
- **Description:** User-supplied provider model (name + URL template); query substitution; returns a list of links only (never auto-download); ships with **empty** provider list; persisted in SQLite.
- **Acceptance:** Add/edit/remove providers; a query against a configured provider returns link results; no network auto-download; ships empty; unit-tested template substitution.
- **Branch:** `work/w9-search` · **Design doc:** `docs/design/file-search-design.md`

#### W10 — Vibrancy pre-blur backend
- **Description:** Rust `image`-crate pipeline: downscale selected cover art → gaussian blur → cache; `invoke` returns the blurred bitmap (asset path / data URI) for the React hero; off-thread; per-game cache.
- **Acceptance:** Given a cover-art path, returns a cached pre-blurred bitmap; second call hits cache; runs off the UI thread; unit-tested blur+cache.
- **Branch:** `work/w10-blur` · **Design doc:** D2 (impl)

#### W11 — Fleet / Ensign
- **Description:** Ensign identity (stable instance id `harmony-{env}-{ordinal}`, version manifest); write `fleet-instance.json` (`schema_version: 1` **integer**) to the deployed root; mirror `versions/{vX.Y.Z}/` + `current` layout; bind a localhost `GET /fleet/v1/status` + `/healthz` while running (FleetStatus/FleetManifest schemas from the contract); declare RetroArch + cores as dependency edges.
- **Acceptance:** Writes a contract-valid `fleet-instance.json`; the localhost endpoint serves the documented JSON with `schema_version` as an integer; instance id is stable across restarts; a registration snippet for Mission Control `instances.json` is produced; schema serialization unit-tested.
- **Branch:** `work/w11-fleet` · **Design doc:** `docs/design/fleet-ensign-design.md`

#### W12 — Familiar enrichment
- **Description:** Soft-dependency client: configurable base URL (default `127.0.0.1:2121`); `GET /healthz` presence probe; Bearer key (stored in macOS Keychain) validated against `/integration/v1/capabilities`; enrich (fuzzy title / ambiguous-dump) via `/integration/v1/jobs` or `/v1/chat/completions`; degrade silently on absent/401/429; cache results.
- **Acceptance:** Detects Familiar present/absent via the two-stage probe; absent → AI affordances hidden, all else works; key in Keychain (never plaintext); enrichment cached; `X-Consumer-Id: harmony` sent; timeouts treated as absent.
- **Branch:** `work/w12-familiar` · **Design doc:** `docs/design/familiar-enrichment-design.md`

### Phase 2 — Frontend

#### W13 — Library grid + hero + detail
- **Description:** Aura `card-grid`/list-page library with translucent shelves; hero backdrop rendered from W10 pre-blurred art with crossfade on selection; per-game detail view (detail-page archetype) with art + metadata + launch.
- **Acceptance:** Grid populated from a real scan with boxart; selecting a game crossfades the blurred hero; detail view launches via W7; vibrancy visible through shelves; Framer Motion transitions (no blur).
- **Branch:** `work/w13-library-ui` · **Design doc:** `docs/design/harmony-ux-design.md` (extends)

#### W14 — Controller input layer
- **Description:** `tauri-plugin-gamepad` (gilrs-backed); semantic action layer (Confirm/Back/Nav/Menu/Quit) with per-family defaults; norigin-spatial-navigation focus over the grid/menus; on-screen focus states + PromptFont/Xelu glyph hints; bindings persisted in SQLite; **thin integration spike first**.
- **Acceptance:** Grid + menus fully navigable + launch + back by controller alone for Xbox/PS/8BitDo/Switch Pro (per available hardware); focus ring + hint bar render; rebinding persists; confirm/back default by family.
- **Branch:** `work/w14-controller` · **Design doc:** `docs/design/controller-input-design.md`

#### W15 — Settings
- **Description:** Aura settings-page screens for content folders, cores (per-system active), controller bindings, search providers, and the Familiar connection (base URL + key).
- **Acceptance:** Each settings surface reads/writes via its backend; folder add triggers scan; core select updates active; provider CRUD; Familiar key stored in Keychain; controller-only operable.
- **Branch:** `work/w15-settings` · **Design doc:** `docs/design/harmony-ux-design.md` (extends)

#### W16 — Cores management UI
- **Description:** UI over W5: per-system available/installed cores, install/update progress, set-active.
- **Acceptance:** Install/update/select a core per system from the UI; progress + arch-rejection surfaced; controller-navigable.
- **Branch:** `work/w16-cores-ui` · **Design doc:** `docs/design/harmony-ux-design.md` (extends)

#### W17 — File-search UI
- **Description:** UI over W9: query box, provider picker, results as a list of clickable links (open in browser); empty-state when no providers.
- **Acceptance:** Query returns links that open in the system browser; never auto-downloads; empty-state guides adding a provider; controller-navigable.
- **Branch:** `work/w17-search-ui` · **Design doc:** `docs/design/file-search-design.md` (extends)

### Phase 3 — Integrate / verify / ship

#### W18 — Visual-inspection CLI + smoke green
- **Description:** Implement the framework-required `gui-visual-inspection-cli` (headless screenshot / render-to-file / automation endpoint) and make `recipe.py smoke` green for the served UI surface.
- **Acceptance:** A non-interactive command captures a screenshot/render of the running app to a file; `recipe.py smoke` exits 0; documented in the UX tier.
- **Branch:** `work/w18-smoke` · **Design doc:** `docs/design/runtime-verification-design.md` (Harmony section)

#### W19 — Dependency Channel conformance
- **Description:** Populate `vendor.toml` with the Aura `[deps.aura]` entry reflecting the submodule pin decision; reconcile with `vendor.lock`; ensure `recipe.py sync-deps`/`vendor-check` (or the submodule-aware equivalent) pass; document the submodule↔Dependency-Channel reconciliation (ref design-language#858).
- **Acceptance:** `vendor.toml` declares Aura; the vendored bytes verify; a `vendor-check` passes offline; the reconciliation is documented.
- **Branch:** `work/w19-depchannel` · **Design doc:** `docs/design/dependency-channel-conformance.md`
- **Note:** Carries the upstream gap [design-language#858](https://github.com/rhohn94/design-language/issues/858).

#### W20 — README + user/workflow docs
- **Description:** README: setup, the RetroArch dependency, the Grimoire workflow, how to add content folders + search providers, and the "no game content shipped" stance.
- **Acceptance:** README covers install/build, RetroArch requirement, content-folder + provider setup, and the Grimoire branch/release model.
- **Branch:** `work/w20-readme` · **Design doc:** —

#### W21 — Create repo + Release v0.1
- **Description:** Create `rhohn94/harmony` on GitHub; build the notarized arm64 DMG; run `project-release` (dev→main, tag `v0.1`, `gh release create` with the DMG asset); write `versions/{v0.1.0}/` + `current` in the deployed root with `release.json` + `grimoire-build-info.json`.
- **Acceptance:** GitHub repo exists; `v0.1` tag + a **GitHub Release object** with the DMG; deployed-instance layout populated; `fleet-instance.json` reflects v0.1.0. **Push is human-gated — stop for explicit user go.**
- **Branch:** (integration master, `project-release`) · **Design doc:** `version-design.md`

---

## 3. Parallel Implementation Strategy

Work-item worktrees branch off `version/0.1` (not `dev`). Passes:

| Pass | Items | Gate |
|---|---|---|
| **D** | D1 → then D2, D3 (parallel) | D1 fixes the IPC/DB/module contract first |
| **0a** | W1 | The repo skeleton; sole bottleneck |
| **0b** | W2, W3, W4 (parallel) | after W1 merged |
| **1** | W5, W6, W7, W8, W9, W10, W11, W12 (parallel) | after Pass 0 merged |
| **2** | W13, W14, W15, W16, W17 (parallel) | after their backends + W2 merged |
| **3** | W18, W19, W20 (parallel) → W21 (last) | after Pass 2; W21 is the human-gated ship |

**Conflict map (shared files the integration master resolves at merge):**
- `src-tauri/src/commands/mod.rs` + `lib.rs` (command registration) — every backend appends; W1 establishes an append-friendly pattern.
- `src-tauri/Cargo.toml` / `package.json` (deps) — multiple items add deps.
- `src/ipc/commands.ts` + routing (`App.tsx`/routes) — every frontend item extends; W2 establishes the pattern.
- `.claude/recipes.json` — W1 owns; later items only add targets.
- Per-domain `core/<x>/`, `commands/<x>.rs`, `features/<x>/` are **non-overlapping** by design.

---

## 4. Out of Scope for v0.1

Deferred to **v0.2** (see roadmap): ScreenScraper metadata (user API key); deeper AI enrichment polish; refined controller-binding UI; additional art fallbacks. Deferred to **v0.3**: systems beyond NES/SNES/N64; collections/favorites/play-time. **Permanent non-goals:** writing emulation; bundling/shipping game content; Mac App Store distribution (private-API vibrancy + external dylib loading). No `Grimoire-Requirement`-tagged issues were open at planning time (tracker repo not yet created); the four `[framework-required]` baseline capabilities are all in-scope (W1/W18).

---

## 5. Status Ledger

### Pass D — Design contracts
| Branch | Design doc | Implemented | Reviewed | Merged into version/0.1 |
|---|---|---|---|---|
| `work/d1-architecture` (D1) | ☑ | ☑ | ☑ | ☑ |
| `work/d2-vibrancy` (D2) | ☑ | ☑ | ☑ | ☑ |
| `work/d3-aura-ux` (D3) | ☑ | ☑ | ☑ | ☑ |

### Pass 0 — Scaffold
| Branch | Design doc | Implemented | Reviewed | Merged into version/0.1 |
|---|---|---|---|---|
| `work/w1-scaffold` (W1) | ☑ | ☑ | ☑ | ☑ |
| `work/w2-aura` (W2) | ☑ | ☑ | ☑ | ☑ |
| `work/w3-sqlite` (W3) | ☑ | ☑ | ☑ | ☑ |
| `work/w4-infra` (W4) | ☑ | ☑ | ☑ | ☑ |

### Pass 1 — Rust backends
| Branch | Design doc | Implemented | Reviewed | Merged into version/0.1 |
|---|---|---|---|---|
| `work/w5-cores` (W5) | ☑ | ☑ | ☑ | ☑ |
| `work/w6-library` (W6) | ☑ | ☑ | ☑ | ☑ |
| `work/w7-launch` (W7) | ☑ | ☑ | ☑ | ☑ |
| `work/w8-metadata` (W8) | ☑ | ☑ | ☑ | ☑ |
| `work/w9-search` (W9) | ☑ | ☑ | ☑ | ☑ |
| `work/w10-blur` (W10) | ☑ | ☑ | ☑ | ☑ |
| `work/w11-fleet` (W11) | ☑ | ☑ | ☑ | ☑ |
| `work/w12-familiar` (W12) | ☑ | ☑ | ☑ | ☑ |

### Pass 2 — Frontend
| Branch | Design doc | Implemented | Reviewed | Merged into version/0.1 |
|---|---|---|---|---|
| `work/w13-library-ui` (W13) | ☑ | ☑ | ☑ | ☑ |
| `work/w14-controller` (W14) | ☑ | ☑ | ☑ | ☑ |
| `work/w15-settings` (W15) | ☑ | ☑ | ☑ | ☑ |
| `work/w16-cores-ui` (W16) | ☑ | ☑ | ☑ | ☑ |
| `work/w17-search-ui` (W17) | ☑ | ☑ | ☑ | ☑ |

### Pass 3 — Integrate / verify / ship
| Branch | Design doc | Implemented | Reviewed | Merged into version/0.1 |
|---|---|---|---|---|
| `work/w18-smoke` (W18) | ☑ | ☑ | ☑ | ☑ |
| `work/w19-depchannel` (W19) | ☑ | ☑ | ☑ | ☑ |
| `work/w20-readme` (W20) | ☑ | ☑ | ☑ | ☑ |
| `work/w21-release` (W21) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

- **Full-UI headless screenshot (v0.2):** the W18 visual-inspection capture renders
  the web bundle without a Tauri IPC runtime, so mount-time `invoke` calls fail and
  `#root` renders empty (only the Aura theme + brand-gradient backdrop show). Add a
  mock-IPC harness so the smoke screenshot captures populated shelves.
- **Reconciliations applied at integration:** Familiar default URL unified to
  `127.0.0.1:2121` (was `8765` in W4); deployed version dir unified to the
  v-prefixed `v0.1.0` across W4 telemetry + W11 fleet (architecture §4.2).
- **Settings glue:** added `save_familiar_config` (base URL → config, key → Keychain)
  to wire W15 settings to the W12 backend.
- **Dependency Channel ↔ submodule:** `sync-deps` cannot model a git submodule;
  Aura is recorded via a `[submodules.aura]` table in `vendor.toml`/`vendor.lock`
  (kind `git-submodule`), not an asset-bundle `[deps.aura]` (design-language#858).
- **Live-hardware controller test:** W14's gamepad polling (`useGamepadPoll`) is
  unit-tested for the semantic/spatial logic only; real-pad verification is deferred.
