# Architecture Design — Harmony v0.1

> **Up:** [↑ Design docs](README.md)

> **Status:** authoritative master contract for v0.1 "Foundation". Every other
> work item (D2, D3, W1–W21) implements against this doc. Where a feature design
> doc disagrees with this file, **this file wins** until reconciled here.

## Motivation

Harmony is a polished, Mac-native (Apple Silicon) emulator **frontend / launcher** —
**not** an emulator. It orchestrates [RetroArch](https://www.retroarch.com/) +
libretro cores, scans user-configured content folders, identifies ROMs against
No-Intro DATs, fetches cover art, and launches games. It ships **no** game content.

The release is built by ~20 parallel work-item agents, each on its own worktree
branch, merged by an integration master. For that to converge without collisions,
the **module map**, the **IPC command surface**, the **SQLite schema**, the
**on-disk layouts**, and the **two native seams** must be fixed up front. That is
this document. It exists so a downstream agent can implement its slice by reading
*one* contract and never guessing at a command name, an arg shape, a table column,
or a file path.

## Scope

**Covered:** frontend + backend module maps and the append-friendly registration
pattern; the complete typed `invoke` surface (TS arg/return + Rust signature per
command) with a unified error contract; the full SQLite DDL + migration approach;
the macOS app-support and deployed-instance directory layouts; an overview +
cross-link of the two critical seams (native vibrancy, Aura-in-React).

**Not covered (delegated, cross-linked below):** the vibrancy config keys and
pre-blur pipeline internals ([native-vibrancy-design.md](native-vibrancy-design.md), D2);
the Aura submodule/theming internals ([ux/design-language.md](ux/design-language.md), D3);
each domain's algorithm details (its own feature doc — see [§7](#7-cross-links)).

---

## 1. Module map

### 1.1 Frontend — `src/`

React 19 + TypeScript + Vite. **Aura** is the design language (NO Tailwind); Framer
Motion handles transitions. The frontend never calls `window.__TAURI__.invoke`
directly — it goes through the typed `src/ipc/` layer.

```
src/
  main.tsx                     # Vite entry; mounts <App/>, installs anti-FOUC theme (D3)
  App.tsx                      # AuraApp shell + router; mounts the hint bar + hero backdrop
  routes.tsx                   # route table (screen → feature page); append-friendly
  ipc/
    invoke.ts                  # invoke<TArgs,TReturn>() wrapper; AppError decode; one chokepoint
    commands.ts                # SHARED: re-exports every domain command module (append-only)
    error.ts                   # AppError TS union (mirrors Rust error.rs) + type guards
    library.ts                 # typed wrappers: scan_folder, list_games, …
    cores.ts                   # typed wrappers: list_available_cores, install_core, …
    launch.ts                  # launch_game, locate_retroarch, set_retroarch_path
    metadata.ts                # fetch_boxart, get_cached_art
    search.ts                  # list_providers, add_provider, …, run_search
    vibrancy.ts                # get_blurred_hero
    fleet.ts                   # get_fleet_status
    familiar.ts                # probe_familiar, enrich_game
    settings.ts                # get_settings, update_settings
    controllers.ts             # list_bindings, set_binding
  features/                    # one folder per domain; non-overlapping across agents
    library/                   # W13 — grid, hero, detail  (screens: Library, GameDetail)
    cores/                     # W16 — core management UI    (screen: Cores)
    search/                    # W17 — file-search UI        (screen: Search)
    controller/                # W14 — focus/nav layer + hint bar + glyphs
    settings/                  # W15 — settings surfaces     (screen: Settings)
  components/                  # cross-feature presentational components (Aura-wrapped)
    HeroBackdrop.tsx           # consumes get_blurred_hero; crossfades (W10/W13)
    HintBar.tsx                # controller button hints (W14)
    FocusRing.tsx              # spatial-nav focus state (W14)
  theme/                       # D3/W2 — Aura wiring: 3-knob OKLCH, named themes, anti-FOUC
    AuraProvider.tsx
    tokens.ts                  # brand-knob values (--aura-primary/-secondary/-on-primary)
  lib/                         # framework-free helpers (formatting, guards); unit-tested
```

**Screen → folder map (v0.1):**

| Screen | Route | Folder | Work item |
|---|---|---|---|
| Library grid | `/` | `features/library/` | W13 |
| Game detail | `/game/:id` | `features/library/` | W13 |
| Cores | `/cores` | `features/cores/` | W16 |
| File search | `/search` | `features/search/` | W17 |
| Settings | `/settings` | `features/settings/` | W15 |

The controller layer (W14) and hero backdrop are **cross-cutting** — they live in
`features/controller/` + `components/` and wrap the router, not a single screen.

**Append-friendly frontend pattern (shared files W2 establishes):**
`src/ipc/commands.ts` is a barrel — each domain item adds exactly **one**
`export * from "./<domain>";` line. `src/routes.tsx` is an array — each screen item
adds exactly **one** route object. No item edits another item's lines, so the
integration master resolves these by concatenation.

### 1.2 Backend — `src-tauri/src/`

Rust + Tauri 2.0. Domain logic lives in `core/<domain>/` and is pure/testable;
`commands/<domain>.rs` is a thin `#[tauri::command]` adapter that calls `core` and
maps results into the unified `AppError`. **One file per module**, brief summary
comment atop each.

```
src-tauri/
  Cargo.toml                   # SHARED: deps appended per item
  tauri.conf.json              # D2 owns window/vibrancy keys
  src/
    main.rs                    # thin; calls harmony_lib::run()
    lib.rs                     # app builder; registers commands via the macro (see below)
    error.rs                   # AppError enum + Serialize → typed TS union; From impls
    telemetry.rs               # run.json writer (W4); run lifecycle events
    config/
      mod.rs                   # AppConfig model (serde); load/save
      paths.rs                 # app-support + deployed-instance path resolution (W4)
    db/
      mod.rs                   # Db handle (rusqlite Connection pool), open-at-path
      migrations.rs            # versioned, idempotent migration runner (W3)
      migrations/              # NNN_<name>.sql files, applied in order
    commands/
      mod.rs                   # SHARED: register_commands! aggregation (append-only)
      library.rs               # W6/W13 adapters
      cores.rs                 # W5/W16 adapters
      launch.rs                # W7 adapters
      metadata.rs              # W8 adapters
      search.rs                # W9/W17 adapters
      vibrancy.rs              # W10 adapters
      fleet.rs                 # W11 adapters
      familiar.rs              # W12 adapters
      settings.rs              # W4/W15 adapters
      controllers.rs           # W14 adapters
    core/                      # domain logic — NON-OVERLAPPING per item
      library/                 # W6: walker, hashing, DAT parse/match, repo
      cores/                   # W5: buildbot client, arch check, system→core map, repo
      launch/                  # W7: RetroArch locate + arg builder + spawn
      metadata/                # W8: thumbnails client, name sanitizer, art cache, repo
      search/                  # W9: provider model, template substitution, repo
      vibrancy/                # W10: image downscale→gaussian→cache pipeline
      fleet/                   # W11: Ensign identity, FleetStatus, localhost server
      familiar/                # W12: two-stage probe, Keychain key, enrich client
      settings/                # W4/W15: settings repo (typed keys)
      controllers/             # W14: binding model + defaults + repo
```

**Append-friendly backend pattern (shared files W1 establishes):**

`commands/mod.rs` declares each domain with **one** `pub mod <domain>;` line and
exposes a single macro the builder invokes once. Each backend item adds its module
line and its commands to the central handler list via the macro — no item edits
another's body:

```rust
// src-tauri/src/commands/mod.rs  (W1 seeds this; each item APPENDS)
pub mod library;   // W6/W13
pub mod cores;     // W5/W16
// … one line per domain …

/// Single source of truth for the invoke_handler. Each domain contributes its
/// commands here; the list is the only shared edit point and merges by append.
#[macro_export]
macro_rules! register_commands {
    ($builder:expr) => {
        $builder.invoke_handler(tauri::generate_handler![
            // library
            crate::commands::library::scan_folder,
            crate::commands::library::list_games,
            // … each item appends its command paths here …
        ])
    };
}
```

```rust
// src-tauri/src/lib.rs  (W1 seeds; stable thereafter)
pub fn run() {
    let builder = tauri::Builder::default()
        .setup(harmony_setup);          // db open + migrate, config, telemetry, fleet
    crate::register_commands!(builder)
        .run(tauri::generate_context!())
        .expect("error while running Harmony");
}
```

Because the **only** shared edit point is the `generate_handler!` list inside the
macro (and one `pub mod` line), the integration master resolves backend command
collisions the same way as the frontend barrel: concatenation, never overwrite.

---

## 2. Tauri `invoke` command surface

**Unified error contract.** Every command returns Rust `Result<T, AppError>`.
`AppError` `Serialize`s to a **typed, discriminated** JSON object; the TS side
decodes it through `ipc/invoke.ts` into an `AppError` union and either resolves the
typed return or throws the typed error. No command returns a bare string error.

```rust
// src-tauri/src/error.rs
/// Unified IPC error. The `kind` tag is the discriminant TS narrows on.
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum AppError {
    NotFound(String),          // entity absent (game/core/provider id)
    Io(String),                // filesystem / process failure
    Db(String),                // sqlite / migration failure
    Network(String),           // buildbot / thumbnails / familiar transport
    Validation(String),        // bad arg (e.g. empty url_template)
    Unsupported(String),       // e.g. non-arm64 dylib, unknown system
    Dependency(String),        // external dep missing (RetroArch absent)
    Conflict(String),          // unique-constraint / already-exists
    Internal(String),          // catch-all; bug
}
pub type AppResult<T> = Result<T, AppError>;
```

```ts
// src/ipc/error.ts  (mirror — keep in lock-step with error.rs)
export type AppErrorKind =
  | "not_found" | "io" | "db" | "network" | "validation"
  | "unsupported" | "dependency" | "conflict" | "internal";
export interface AppError { kind: AppErrorKind; detail: string; }
export function isAppError(e: unknown): e is AppError { /* tag check */ }
```

```ts
// src/ipc/invoke.ts — the single chokepoint
export async function invoke<TReturn>(cmd: string, args?: Record<string, unknown>): Promise<TReturn> {
  try { return await tauriInvoke<TReturn>(cmd, args); }
  catch (raw) { throw decodeAppError(raw); }  // → typed AppError
}
```

Conventions: command names are `snake_case` (Tauri maps JS camelCase args to Rust
snake_case automatically — **arg keys below are the TS/JS camelCase form**, Rust
params are snake_case). IDs are `i64` in Rust / `number` in TS. Timestamps are
Unix epoch **seconds** (`i64` / `number`). All commands are `async` on the Rust
side (return `AppResult<T>`); blocking work runs on a Tokio blocking task.

Shared TS DTOs (defined in `ipc/<domain>.ts`, re-exported from `ipc/commands.ts`):

```ts
export interface Game {
  id: number; path: string; system: string; crc32: string | null; md5: string | null;
  cleanName: string; datMatched: boolean; coreHint: string | null;
  artPath: string | null; sizeBytes: number; addedAt: number;
}
export interface ContentFolder { id: number; path: string; enabled: boolean; addedAt: number; }
export interface Core {
  id: number; system: string; coreId: string; installedPath: string | null;
  version: string | null; lastModified: number | null; active: boolean; available: boolean;
}
export interface SearchProvider { id: number; name: string; urlTemplate: string; enabled: boolean; }
export interface SearchResult { providerId: number; providerName: string; title: string; url: string; }
export interface ControllerBinding { id: number; deviceFamily: string; action: string; button: string; }
export interface Settings { [key: string]: string | number | boolean | null; }
export interface BlurredHero { dataUri: string | null; cachePath: string; width: number; height: number; }
export interface FleetStatus {
  schemaVersion: number; instanceId: string; version: string;
  status: "ok" | "degraded"; uptimeSeconds: number; dependencies: { name: string; present: boolean }[];
}
export interface FamiliarProbe { present: boolean; authorized: boolean; baseUrl: string; }
```

### 2.1 library (W6 / W13)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `add_content_folder` | `{ path: string }` | `ContentFolder` | `async fn add_content_folder(path: String) -> AppResult<ContentFolder>` |
| `list_content_folders` | `{}` | `ContentFolder[]` | `async fn list_content_folders() -> AppResult<Vec<ContentFolder>>` |
| `remove_content_folder` | `{ id: number }` | `void` | `async fn remove_content_folder(id: i64) -> AppResult<()>` |
| `scan_folder` | `{ id: number }` | `ScanReport` | `async fn scan_folder(id: i64) -> AppResult<ScanReport>` |
| `rescan` | `{}` | `ScanReport` | `async fn rescan() -> AppResult<ScanReport>` |
| `list_games` | `{ system?: string }` | `Game[]` | `async fn list_games(system: Option<String>) -> AppResult<Vec<Game>>` |
| `get_game` | `{ id: number }` | `Game` | `async fn get_game(id: i64) -> AppResult<Game>` |

`ScanReport = { folderId: number; scanned: number; identified: number; unidentified: number; added: number }`.

### 2.2 cores (W5 / W16)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `list_available_cores` | `{ system?: string }` | `Core[]` | `async fn list_available_cores(system: Option<String>) -> AppResult<Vec<Core>>` |
| `list_installed_cores` | `{}` | `Core[]` | `async fn list_installed_cores() -> AppResult<Vec<Core>>` |
| `install_core` | `{ system: string; coreId: string }` | `Core` | `async fn install_core(system: String, core_id: String) -> AppResult<Core>` |
| `update_core` | `{ id: number }` | `Core` | `async fn update_core(id: i64) -> AppResult<Core>` |
| `set_active_core` | `{ system: string; coreId: string }` | `Core` | `async fn set_active_core(system: String, core_id: String) -> AppResult<Core>` |

### 2.3 launch (W7)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `launch_game` | `{ gameId: number; fullscreen?: boolean }` | `void` | `async fn launch_game(game_id: i64, fullscreen: Option<bool>) -> AppResult<()>` |
| `locate_retroarch` | `{}` | `string \| null` | `async fn locate_retroarch() -> AppResult<Option<String>>` |
| `set_retroarch_path` | `{ path: string }` | `void` | `async fn set_retroarch_path(path: String) -> AppResult<()>` |

`launch_game` resolves the active core for the game's system; absent RetroArch →
`AppError::Dependency`.

### 2.4 metadata / art (W8)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `fetch_boxart` | `{ gameId: number }` | `string` (art_path) | `async fn fetch_boxart(game_id: i64) -> AppResult<String>` |
| `get_cached_art` | `{ gameId: number }` | `string \| null` | `async fn get_cached_art(game_id: i64) -> AppResult<Option<String>>` |

### 2.5 search providers (W9 / W17)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `list_providers` | `{}` | `SearchProvider[]` | `async fn list_providers() -> AppResult<Vec<SearchProvider>>` |
| `add_provider` | `{ name: string; urlTemplate: string }` | `SearchProvider` | `async fn add_provider(name: String, url_template: String) -> AppResult<SearchProvider>` |
| `update_provider` | `{ id: number; name?: string; urlTemplate?: string; enabled?: boolean }` | `SearchProvider` | `async fn update_provider(id: i64, name: Option<String>, url_template: Option<String>, enabled: Option<bool>) -> AppResult<SearchProvider>` |
| `remove_provider` | `{ id: number }` | `void` | `async fn remove_provider(id: i64) -> AppResult<()>` |
| `run_search` | `{ query: string; providerId?: number }` | `SearchResult[]` | `async fn run_search(query: String, provider_id: Option<i64>) -> AppResult<Vec<SearchResult>>` |

`run_search` returns **links only** — never downloads.

### 2.6 vibrancy blur (W10) — seam D2

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `get_blurred_hero` | `{ gameId: number }` | `BlurredHero` | `async fn get_blurred_hero(game_id: i64) -> AppResult<BlurredHero>` |

### 2.7 fleet (W11)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `get_fleet_status` | `{}` | `FleetStatus` | `async fn get_fleet_status() -> AppResult<FleetStatus>` |

`schemaVersion` serializes as an **integer** (`schema_version: 1`).

### 2.8 familiar (W12)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `probe_familiar` | `{}` | `FamiliarProbe` | `async fn probe_familiar() -> AppResult<FamiliarProbe>` |
| `enrich_game` | `{ gameId: number }` | `Game` | `async fn enrich_game(game_id: i64) -> AppResult<Game>` |

Absent/401/429/timeout → `present:false`/`authorized:false`, never an error.

### 2.9 settings (W4 / W15)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `get_settings` | `{}` | `Settings` | `async fn get_settings() -> AppResult<Settings>` |
| `update_settings` | `{ patch: Settings }` | `Settings` | `async fn update_settings(patch: HashMap<String,JsonValue>) -> AppResult<Settings>` |

### 2.10 controllers (W14)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `list_bindings` | `{ deviceFamily?: string }` | `ControllerBinding[]` | `async fn list_bindings(device_family: Option<String>) -> AppResult<Vec<ControllerBinding>>` |
| `set_binding` | `{ deviceFamily: string; action: string; button: string }` | `ControllerBinding` | `async fn set_binding(device_family: String, action: String, button: String) -> AppResult<ControllerBinding>` |

---

## 3. SQLite schema

rusqlite, one DB file under app-support (`§4.1`). Migrations are **versioned and
idempotent**: `db/migrations.rs` reads `PRAGMA user_version`, applies each
`migrations/NNN_*.sql` whose number exceeds it inside a transaction, then bumps
`user_version`. v0.1 ships migration `001_init.sql` below. `PRAGMA foreign_keys =
ON` is set on every connection. No magic numbers — system names, action names, and
device families are validated in `core/` against named constants.

```sql
-- 001_init.sql  (idempotent: guarded by user_version in the runner)

CREATE TABLE IF NOT EXISTS content_folders (
  id        INTEGER PRIMARY KEY,
  path      TEXT    NOT NULL UNIQUE,
  enabled   INTEGER NOT NULL DEFAULT 1,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY,
  folder_id   INTEGER NOT NULL REFERENCES content_folders(id) ON DELETE CASCADE,
  path        TEXT    NOT NULL UNIQUE,
  system      TEXT    NOT NULL,            -- 'nes' | 'snes' | 'n64'
  crc32       TEXT,                        -- header-stripped, lowercase hex
  md5         TEXT,
  clean_name  TEXT    NOT NULL,            -- No-Intro title or filename fallback
  dat_matched INTEGER NOT NULL DEFAULT 0,
  core_hint   TEXT,                        -- suggested core_id for this system
  art_path    TEXT,                        -- cached boxart on disk (NULL until fetched)
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  added_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_system ON games(system);
CREATE INDEX IF NOT EXISTS idx_games_crc32  ON games(crc32);
CREATE INDEX IF NOT EXISTS idx_games_folder ON games(folder_id);

CREATE TABLE IF NOT EXISTS cores (
  id             INTEGER PRIMARY KEY,
  system         TEXT    NOT NULL,
  core_id        TEXT    NOT NULL,         -- e.g. 'mesen' | 'snes9x' | 'mupen64plus_next'
  installed_path TEXT,                     -- NULL = available-but-not-installed
  version        TEXT,
  last_modified  INTEGER,                  -- buildbot Last-Modified epoch (update check)
  active         INTEGER NOT NULL DEFAULT 0,
  UNIQUE(system, core_id)
);
CREATE INDEX IF NOT EXISTS idx_cores_system ON cores(system);
-- exactly one active core per system is enforced in core/cores (set_active_core
-- clears the prior active in the same transaction); partial unique index guard:
CREATE UNIQUE INDEX IF NOT EXISTS idx_cores_one_active
  ON cores(system) WHERE active = 1;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                       -- JSON-encoded scalar; typed in core/settings
);

CREATE TABLE IF NOT EXISTS controller_bindings (
  id            INTEGER PRIMARY KEY,
  device_family TEXT NOT NULL,             -- 'xbox' | 'playstation' | '8bitdo' | 'switchpro'
  action        TEXT NOT NULL,             -- 'confirm' | 'back' | 'nav_up' | … | 'quit'
  button        TEXT NOT NULL,             -- semantic gamepad button id
  UNIQUE(device_family, action)
);

CREATE TABLE IF NOT EXISTS search_providers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  url_template TEXT NOT NULL,              -- contains the {query} placeholder
  enabled      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS art_cache (
  id         INTEGER PRIMARY KEY,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tier       TEXT NOT NULL,               -- 'boxart' | 'title' | 'snap' | 'placeholder'
  path       TEXT NOT NULL,               -- on-disk cached file
  fetched_at INTEGER NOT NULL,
  UNIQUE(game_id, tier)
);
CREATE INDEX IF NOT EXISTS idx_art_cache_game ON art_cache(game_id);
```

Notes: `games.art_path` denormalizes the chosen display art (highest available
tier) for fast grid reads; `art_cache` holds the full per-tier cache the blur
pipeline (W10) and fallback logic (W8) consult. FKs cascade so removing a folder
or game cleans its rows. The persistence layer (W3) wraps each table in a repo
with CRUD + unit tests — see [persistence-design.md](persistence-design.md).

---

## 4. Directory layouts

### 4.1 macOS app-support layout

Bundle id `com.harmony.app`. Resolved by `config/paths.rs` (W4) — never hard-coded
elsewhere.

```
~/Library/Application Support/com.harmony.app/
  harmony.db                    # the SQLite DB (§3)
  config/
    app-config.json             # AppConfig (retroarch_path, familiar base url, …)
  cores/                        # installed libretro dylibs
    <system>/<core_id>_libretro.dylib
  art-cache/                    # fetched boxart/title/snap (art_cache.path roots here)
    <system>/<clean_name>.png
  blur-cache/                   # W10 pre-blurred heroes (BlurredHero.cachePath roots here)
    <game_id>.png
  logs/                         # telemetry / run logs (W4)
```

The Familiar Bearer key is **never** written here — it lives in the macOS
**Keychain** (W12). RetroArch path + Familiar base URL live in `app-config.json`
and/or `settings`.

### 4.2 Deployed-instance layout (Fleet/Ensign, W11)

Mirrors the `deployed-apps/familiar` convention: versioned dirs + a `current`
symlink the fleet reads.

```
deployed-apps/harmony/
  current -> versions/v0.1.0           # symlink to the live version
  versions/
    v0.1.0/
      release.json                     # release metadata (version, dmg, sha, date)
      grimoire-build-info.json         # build provenance (commit, branch, builder)
      fleet-instance.json              # Ensign identity; schema_version: 1 (INTEGER)
      run.json                         # telemetry: last run lifecycle (W4 writes)
```

`fleet-instance.json` carries the stable instance id `harmony-{env}-{ordinal}`,
the version manifest, and declared dependency edges (RetroArch + cores). The
localhost `GET /fleet/v1/status` + `/healthz` endpoints serve the `FleetStatus`
shape (§2.7) while the app runs — see [fleet-ensign-design.md](fleet-ensign-design.md).

---

## 5. The two critical seams

### 5.1 Native-vibrancy seam — detailed in **D2**

macOS native vibrancy via `NSVisualEffectView`, driven by Tauri `windowEffects`
(sidebar material). Requires `macOSPrivateApi: true` + `transparent: true` in
`tauri.conf.json`, a transparent-webview CSS contract (the web layer paints
content on **transparent** background so the native blur shows through), and a
Rust **pre-blurred-hero handoff**: the `image` crate downscales → gaussian-blurs →
caches a per-game hero bitmap, returned by `get_blurred_hero` (§2.6) to the React
`HeroBackdrop`. **No CSS `backdrop-filter`** — it is broken in transparent
WKWebView (Tauri [#12804](https://github.com/tauri-apps/tauri/issues/12804)).
Full config keys, drag-region / traffic-light handling, and the blur pipeline:
[native-vibrancy-design.md](native-vibrancy-design.md).

### 5.2 Aura-in-React seam — detailed in **D3**

Aura is consumed via a **git-submodule pin** of `rhohn94/design-language` to its
official `bindings/react`. Theming is the **3-knob OKLCH** model
(`--aura-primary` / `--aura-secondary` / `--aura-on-primary`). Aura web components
use `events` / `class` — **not** React's `onChange` / `className`; the typed
wrappers in `theme/` + `components/` honor that. **Known upstream gap:** Aura's
v3.20 release **asset** ships `css/js/dist/templates` but **not** `bindings/react`
(filed as design-language [#858](https://github.com/rhohn94/design-language/issues/858))
— hence the submodule pin rather than a package install. Full submodule path,
pinned SHA, anti-FOUC, and archetype→screen map:
[ux/design-language.md](ux/design-language.md) + [harmony-ux-design.md](harmony-ux-design.md).

---

## 6. House standards in this architecture

- **OO where it fits:** `core/<domain>` repos share a `Repository` trait (open,
  CRUD); command adapters share an error-mapping helper; no duplicated invoke glue.
- **No magic numbers:** systems, core ids, actions, device families, art tiers,
  and the Familiar default base URL are named constants in `core/`.
- **One file per module**, brief summary comment atop each.
- **Every function unit-testable:** `core/` is pure (no Tauri types); adapters are
  thin. DAT matching, name sanitizing, arg building, template substitution, blur,
  and migrations all have unit tests in their feature items.
- **Unified IPC error contract:** §2's `AppError` is the single error type across
  every command; TS mirrors it in `ipc/error.ts`.
- **Append-only shared files:** `commands/mod.rs`, `lib.rs`, `Cargo.toml`,
  `package.json`, `src/ipc/commands.ts`, `src/routes.tsx`, `.claude/recipes.json`
  use the append patterns in §1 so parallel agents never overwrite each other.

---

## 7. Cross-links

**Seams:** [native-vibrancy-design.md](native-vibrancy-design.md) (D2) ·
[ux/design-language.md](ux/design-language.md) (D3) ·
[harmony-ux-design.md](harmony-ux-design.md) (D3).

**Feature design docs (forward references):**

| Doc | Work item(s) |
|---|---|
| [persistence-design.md](persistence-design.md) | W3 |
| [app-infrastructure-design.md](app-infrastructure-design.md) | W4 |
| [core-management-design.md](core-management-design.md) | W5 / W16 |
| [library-identification-design.md](library-identification-design.md) | W6 / W13 |
| [emulation-launch-design.md](emulation-launch-design.md) | W7 |
| [metadata-art-design.md](metadata-art-design.md) | W8 |
| [file-search-design.md](file-search-design.md) | W9 / W17 |
| [fleet-ensign-design.md](fleet-ensign-design.md) | W11 |
| [familiar-enrichment-design.md](familiar-enrichment-design.md) | W12 |
| [controller-input-design.md](controller-input-design.md) | W14 |
| [runtime-verification-design.md](runtime-verification-design.md) | W18 |
| [dependency-channel-conformance.md](dependency-channel-conformance.md) | W19 |

---

## Open questions

- Whether `update_settings`'s `Settings` value type should be a tagged typed union
  rather than `JsonValue` scalars (resolve in W4 if typed settings emerge).
- Whether `art_cache` should also cache the blurred hero (currently `blur-cache/`
  is keyed by `game_id` on disk, not in a table) — revisit in W10 if a DB index
  over blurred art is needed.
