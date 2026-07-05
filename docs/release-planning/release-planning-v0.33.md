# Release Planning — v0.33

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.33.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.33` |
| **Previous** | v0.32 (Sources Complete — H1 finished: GOG/itch, SteamGridDB, ROM on GameSource) |
| **Theme** | "Bottles" — Horizon H2 first slice: CrossOver bottles and their Windows apps become library entries that launch from the shelves/TV flow. Enumeration + launch only; the guided install flow is deferred. |

---

## 2. Major Features

### W330 — Persisting-source trait reconciliation

The W322-review prerequisite for H2: extend the source abstraction so
persisting scanners are first-class, and make `RomSource` conform, so
CrossOver arrives as "just another `GameSource`" at the type level.

- **Acceptance:** a persisting-source variant exists beside the discover-only
  `GameSourceScanner` (e.g. a second trait or an enum-dispatch layer — design
  §Trait shape decides); `RomSource` implements it with zero behaviour change
  (existing parity/regression tests stay green unmodified); scan
  orchestration dispatches uniformly; no IPC changes.
- **Branch:** `refactor/w330-persisting-source-trait`
- **Design:** `docs/design/crossover-integration-design.md` §Trait shape
  (authored before dispatch).

### W331 — CrossOver detection + bottle/app enumeration

A `crossover` game source: find a CrossOver install, enumerate bottles and
each bottle's installed Windows applications, surface them as library rows.

- **Acceptance:** detection covers the standard CrossOver.app install and its
  bottle directory (`~/Library/Application Support/CrossOver/Bottles`);
  bottle metadata (per-bottle `cxbottle.conf` / installed-app records) parsed
  with fixture tests — no CrossOver required on the build machine; rows
  created with `source = "crossover"` (migration 014 extends the CHECK, same
  pattern as 013), `external_id` = stable bottle+app key, dedup on re-scan;
  missing CrossOver ⇒ clean zero-count scan; Game-sources pane wired like
  GOG/itch; malformed bottle data skipped per-entry, never fails the scan.
- **Branch:** `feat/w331-crossover-source`
- **Design:** `docs/design/crossover-integration-design.md` §Detection,
  §Enumeration.

### W332 — CrossOver launch + play sessions + UI copy

Launch enumerated Windows apps through CrossOver from the same detail page
and TV flow, with play-session tracking.

- **Acceptance:** a `crossover` launch-descriptor kind whose argv invokes
  CrossOver's CLI (`--bottle <name>` + target; separate argv elements, no
  shell strings — same safety rules as W311); launch failures surface the
  existing clean `AppError` path; play sessions tracked via the existing
  app-focus observation (document the accuracy caveat for Wine processes);
  detail page shows "Launches via CrossOver" and hides emulator affordances
  (same pattern as Steam/app rows); source badge for `crossover`; unit tests
  on argv construction; `recipe.py smoke` green.
- **Branch:** `feat/w332-crossover-launch`
- **Design:** `docs/design/crossover-integration-design.md` §Launch,
  §Sessions.

### W334 — Hardening rider (v0.32 review follow-ups)

Five small carryovers, batched:

1. `Db::open` gains a `busy_timeout` (mirror `play/server.rs`'s 5s pattern)
   so detached art-thread writes can't silently drop under contention.
2. itch `scan_install_dir` fallback gates `exec` classification on
   is-file + executable-bit (no unlaunchable data-file rows).
3. GOG/itch discovery rejects empty/relative `installPath` at parse time.
4. W322 test duplication: behavioural scan tests live in `sources/rom.rs`
   only; `library/scan.rs` keeps one thin delegation smoke test.
5. `library/scan.rs` `pub use super::dat::DatIndex` → plain `use`.

- **Acceptance:** each item unit-tested (contention test may be a
  busy-timeout-is-set assertion); no behaviour change beyond the guards.
- **Branch:** `fix/w334-hardening-rider`
- **Design:** n/a.

### W335 — Release-pipeline DMG fix (#45)

Fix the broken-since-v0.26 DMG bundling: tauri's `bundle_dmg.sh` writes its
`rw.$$` temp image inside `bundle/macos/` (the hdiutil srcfolder), so the
image copy swallows its own growing temp file.

- **Acceptance:** `scripts/release_sign_notarize.py` produces the DMG via the
  proven clean-staging path (`hdiutil create -srcfolder <staging: .app +
  /Applications symlink> -format UDZO`) instead of relying on
  `bundle_dmg.sh`; a guard asserts `bundle/macos/` contains only the `.app`
  before staging; stale `rw.*.dmg` artifacts cleaned pre-build; unit tests
  cover the staging-dir builder and the guard (no real hdiutil in CI —
  subprocess seam mocked); the signing/notarization conditional steps are
  untouched; closes #45.
- **Branch:** `fix/w335-dmg-pipeline`
- **Design:** `docs/design/notarization-distribution-design.md` §DMG
  assembly (extend with the clean-staging approach).

---

## 3. Parallel Implementation Strategy

| Pass | Items | Rationale |
|---|---|---|
| 1 | W330 + W335 | W330 settles the trait before W331 targets it; W335 is Python release tooling, fully disjoint. |
| 2 | W331 + W334 | W331 builds on the settled trait (new `sources/crossover.rs` + migration 014); W334 touches `db/mod.rs`, `itch.rs`/`gog.rs` parse guards, `scan.rs`/`rom.rs` tests — no file overlap with W331. |
| 3 | W332 | Launch path + UI lands after W331's rows/descriptors exist. |

**Conflict map** (predicted overlapping files):

- `core/sources/mod.rs`: W330 (trait) and W331 (registration) — separated
  Pass 1 vs Pass 2.
- `core/sources/rom.rs`: W330 (conformance) and W334 (test dedup) —
  separated Pass 1 vs Pass 2.
- `commands/sources.rs`, `ipc/sources.ts`, `GameSourcesPane.tsx`: W331 only
  this release (W332 touches launch/detail surfaces, not the pane).
- Launch surfaces (`core/launch/*`, descriptor types, detail page): W332
  alone in Pass 3.
- Merge order within a pass: W330 before W335; W331 before W334.

**Done-criteria:** every branch green on `pnpm test && cargo test`,
typecheck, lint; W331/W332 (served/UI surfaces) additionally pass
`recipe.py smoke`.

---

## 4. Out of Scope for v0.33

- **Guided "run a Windows game" flow** (pick installer → choose/create
  bottle → appears in library) — v0.34 candidate; large UI epic on its own.
- **Bottle creation/management of any kind** — RGP never creates, patches,
  or configures bottles/Wine this release (roadmap H2 boundary).
- **Storefront purchases, install/uninstall management, in-page play for
  native titles** — roadmap-fixed non-goals.
- **Metadata refresh on re-scan** — unchanged; revisit with #24.
- **Backlog issues** #21, #24, #28, #29, #31, #33, #34, #35, #36, #38, #39,
  #40, #42, #43, #44 — remain backlog; none tagged v0.33.
- **Grimoire-Requirement items** — none open at planning time (tracker read
  returned zero).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.33 |
|---|---|---|---|---|
| `w330-persisting-source-trait-v033p1-00` (W330) | ☑ | ☑ | ☑ | ☑ |
| `w335-dmg-pipeline-v033p1-01` (W335) | ☑ | ☑ | ☑ | ☑ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.33 |
|---|---|---|---|---|
| `w331-crossover-source-v033p2-00` (W331) | ☑ | ☑ | ☑ | ☑ |
| `w334-hardening-rider-v033p2-01` (W334) | n/a | ☑ | ☑ | ☑ |

### Pass 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.33 |
|---|---|---|---|---|
| `w332-crossover-launch-v033p3-00` (W332) | ☑ | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- **Pass-1 note:** dispatched via the write-capable workflow
  (`release-phase-model: Auto`); branch names carry the `-v033p1-NN` suffix.
- Reviewer (W330, non-blocking): confirm at W331 that the TS-side
  `ScanReport` doc comment uses the same tier-neutral wording as the
  de-ROM-ed Rust doc ("total candidate files the walker found").
- Reviewer (W330, informational): `commands/sources.rs` `unreachable!` arm
  names `GameSource::Rom` directly rather than the `Persisting` tier — fine
  while Rom is the only persisting source.
- Reviewer (W335): findings 1+3 (staging copy `symlinks=True`, `.app`
  guard requires a directory) **applied on version/0.33** (f66ca13) per the
  review's recommendation; finding 2 (DMG container is not codesigned —
  Apple-accepted flow, app signed inside, DMG notarized+stapled) recorded
  as intentional, not a gap.
- Reviewer (W331, non-blocking): `external_id` keys on the app **display
  name** (`<bottle>/<name>`) — renaming a launcher stub mints a new row and
  orphans the old on re-scan; a future rung should prefer the stub's
  `CFBundleIdentifier` where present. Recorded beside the design doc's
  fixture-validation follow-up.
- Reviewer (W331, cosmetic): `list_bottles()` returns `read_dir` order
  (non-deterministic) — harmless for dedup; sort if display order ever
  matters.
- Reviewer (W334): zero findings — all five hardening items verified,
  including busy_timeout inheritance at all four contending `Db::open`
  call sites (`open_in_memory` correctly exempt).
- Reviewer (W332, non-blocking): add a `--` argument-terminator before
  `target` in `cxstart_args` as defense-in-depth (target is a `C:\...`
  path today, leading-`-` effectively impossible).
- Reviewer (W332, cosmetic): doc comments reference a
  `core::launch::crossover_launcher` module that is actually
  `external.rs`; design doc says `AppError::Io` where the impl correctly
  uses the more specific `AppError::Dependency` for missing CrossOver —
  reconcile wording.
- **Human follow-up (unchanged from design doc):** on-device verification
  with a real CrossOver install — enumeration field names and the
  `cxstart` CLI surface are fixture-validated only.
