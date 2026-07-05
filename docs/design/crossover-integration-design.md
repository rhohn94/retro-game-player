# CrossOver Integration — Horizon H2 (v0.33 first slice: Bottles)

> **Up:** [↑ Design index](README.md)
> **Status:** agreed for v0.33 — W330 (trait), W331 (source), W332 (launch)
> **Origin:** roadmap §Horizon H2 (user scope directive 2026-07-03); H1
> abstractions shipped v0.31–v0.32 ([non-retro-library-design.md](non-retro-library-design.md))

## Motivation

RGP's ambition ring three: Windows games on macOS through CrossOver, from
the same shelves and TV couch flow as everything else. H1 built the pieces —
ROM-less rows, launch descriptors, pluggable sources, external-launch play
sessions — so H2 is "just another source + descriptor kind", not new
machinery. **Boundary (roadmap-fixed):** RGP orchestrates CrossOver; it
never ships, patches, or configures Wine. CrossOver is a user-installed
prerequisite, exactly like RetroArch.

## Scope

**In (v0.33):** persisting-source trait reconciliation (W330); CrossOver
detection + bottle/app enumeration as a `crossover` source (W331); launch
through CrossOver with play-session tracking and detail/TV copy (W332).

**Out (deferred / non-goals):** the guided "run a Windows game" install
flow (pick installer → choose/create bottle → appears in library) — v0.34
candidate; bottle creation/management of any kind; anything that writes
inside a bottle.

## Design

### Trait shape (W330)

v0.32's W322 landed `RomSource` beside the trait rather than on it: the
discover-only contract (`GameSourceScanner::scan() -> Vec<DiscoveredGame>`)
cannot express a hashing/persisting folder scan. Reconcile with **two
explicit tiers** rather than one lowest-common-denominator trait:

- `GameSourceScanner` (existing, unchanged): pure discovery; the upsert +
  detached-art pipeline in `commands/sources.rs` stays the single persister
  for these (steam, apps, manual, gog, itch, **crossover**).
- New `PersistingSource` trait for sources that own their persistence
  (today only `RomSource`): `scan_and_persist(...) -> ScanReport`, with the
  shared report/dedup vocabulary lifted into `sources/mod.rs` so both tiers
  return the same counts shape to the IPC layer.
- Uniform orchestration: a `SourceKind` dispatch in `sources/mod.rs` maps
  every `games.source` value to its tier; scan commands stay thin adapters.
- **Zero behaviour change is the acceptance bar** — existing W322 parity
  tests must pass unmodified.

CrossOver itself is tier-1 (discover-only): enumeration is cheap metadata
reading; rows persist through the same upsert path as GOG/itch.

### Detection (W331)

CrossOver present ⇔ either exists:

- `/Applications/CrossOver.app` (or `~/Applications/CrossOver.app`) — the
  app itself, and
- `~/Library/Application Support/CrossOver/Bottles/` — the bottle root
  (authoritative for enumeration; configurable roots are a follow-up).

Absence of both ⇒ clean zero-count scan, never an error (same contract as
GOG/itch). Detection never launches or queries a running CrossOver.

### Enumeration (W331)

Two complementary sources of truth, both plain filesystem reads with
fixture-based tests (no CrossOver needed in CI; the implementer must
validate field names against real fixtures checked into the test tree):

1. **Bottle inventory:** each `Bottles/<name>/` directory with a
   `cxbottle.conf` is a bottle (INI-style; display name + template fields
   when present; the directory name is the stable bottle id).
2. **Installed apps per bottle — launcher stubs first:** CrossOver
   generates macOS launcher bundles for installed Windows apps under
   `~/Applications/CrossOver/<Bottle>/<App>.app`. These stubs are the
   primary app list: name from the bundle, bottle from the parent dir,
   icon from the stub's `.icns` (feeds the existing bundle-icon art rung —
   no new art machinery). Where no stub exists, fall back to the bottle's
   `drive_c/users/crossover/Desktop` / `.cxmenu` link records; entries the
   fallback can't classify are skipped per-entry (never fail the scan).

Row shape: `source = "crossover"` (migration **014** extends the CHECK
exactly like 013 did — 12-step rebuild, `requires_fk_off`), `art_hint` =
launcher-stub path when available. `external_id` prefers the launcher stub's
`CFBundleIdentifier` when present (v0.33 reviewer rider, W347 — a stable
macOS-assigned id that survives a display-name rename), falling back to
`"<bottle>/<app-key>"` when absent (the only option for the `.cxmenu`
fallback path, which has no bundle to read a plist from); dedup is always on
`(source, external_id)`. No DB migration accompanies the bundle-id
preference — a re-scan simply mints the new stable id and the existing
dedup handles the one-time transition per row. Steam-owned/app-source-owned
bundles are not double-imported (launcher stubs live under
`~/Applications/CrossOver/` only, so overlap is already structurally
excluded; assert it in tests anyway).

### Launch (W332)

New descriptor kind, same argv-safety rules as every W311 kind (separate
argv elements, never a shell string):

```
| { kind: "crossover", bottle, target }
```

- **Preferred path:** `target` = the launcher-stub `.app` path → launch is
  `open -a <stub>` (reuses the `app` launcher's spawn/session machinery
  wholesale; the distinct kind exists for provenance, UI copy, and the
  fallback below).
- **Fallback path (no stub):** invoke CrossOver's bundled CLI
  (`CrossOver.app/Contents/SharedSupport/CrossOver/bin/cxstart` —
  implementer verifies the exact binary against a real install)
  `--bottle <bottle> -- <target>` as separate argv elements. The `--`
  argument-terminator precedes `target` as defense-in-depth (v0.33 reviewer
  rider, W347), so a target value beginning with `-` cannot be misread by
  `cxstart` as one of its own flags.
- A missing `CrossOver.app` surfaces as `AppError::Dependency` (row stays,
  same posture as a moved GOG bundle); this is a missing-prerequisite
  condition, not an I/O failure, so it does not go through `AppError::Io`.
- **Play sessions:** existing app-focus observation. Caveat to document:
  Wine processes may present as the stub app or as CrossOver itself;
  best-effort accuracy is accepted (same tradeoff recorded for W311).

### UI (W332)

Detail page: "Launches via CrossOver", emulator affordances hidden (exact
Steam/app-row pattern); `crossover` source badge on shelves; rows appear in
the existing "Desktop" library filter and TV rails. No new panes — the
Game-sources pane gains the crossover scan row via W331.

## Acceptance

- [ ] W330: both tiers dispatch uniformly; W322 parity tests green
      unmodified; no IPC change.
- [ ] W331: fixture-driven bottle+app enumeration (stubs primary, links
      fallback); migration 014 CHECK-extends idempotently on a v0.32 DB;
      re-scan duplicates none; no CrossOver ⇒ zero-count clean scan.
- [x] W332: stub rows launch via `open -a`; stubless rows build a correct
      `cxstart --bottle -- <target>` argv (unit-tested, no shell strings);
      session recorded on launch; detail/TV copy correct; full suite +
      `recipe.py smoke` green.
- [x] W347 (v0.34, three reviewer riders on this doc/W332's implementation):
      `cxstart` argv gains a `--` terminator before `target`
      (unit-tested); doc comments reconciled to the actual
      `core::launch::external` module and `AppError::Dependency` (not `Io`);
      `external_id` prefers the launcher stub's `CFBundleIdentifier` when
      present, falling back to `<bottle>/<app-key>` (unit-tested,
      re-scan-stable, no DB migration).
- [ ] On-device verification with a real CrossOver install is a **human
      follow-up** (none available in this environment) — file it, don't
      claim it.

## Follow-ups

- Guided "run a Windows game" flow (v0.34 candidate — the H2 ease-of-use
  bullet).
- Configurable bottle roots; non-default CrossOver install locations.
- Real-install validation of `cxbottle.conf` fields and the `cxstart` CLI
  surface (fixture assumptions → verified facts).
