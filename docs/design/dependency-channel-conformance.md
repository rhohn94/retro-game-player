# Dependency Channel Conformance — Harmony v0.1

> **Up:** [↑ Design docs](README.md)

> **Status:** W19 deliverable. Records how Harmony's single vendored
> dependency — **Aura** (`rhohn94/design-language`) — is reconciled with the
> Grimoire **Dependency Channel** (`vendor.toml` / `vendor.lock` +
> `grm-sync-deps` / `grm-vendor-migrate`). The mechanism is a **git submodule**, not a
> release-asset bundle; this doc explains why the Dependency Channel manifests
> express that truthfully rather than forcing a false asset entry.

## Motivation

The Dependency Channel (`grm-sync-deps`) reconciles first-party deps from **published
GitHub Release channels** into committed `vendor/<dep>/` trees, recording the
resolved truth in `vendor.lock`. Build and runtime read only the vendored bytes;
the network is touched only at sync time. Harmony has exactly one such dependency
to reconcile for v0.1: **Aura**.

But Aura is **not** vendored from a release asset. W2 vendored it as a **git
submodule** pinned to the `v3.20` channel, because the v3.20 **release asset
bundle omits `bindings/react`** — the typed React adapter Harmony imports as
`@aura/react` — which exists only in the source tree
([design-language#858](https://github.com/rhohn94/design-language/issues/858)).
There is therefore **no asset to vendor**. W19's job is to make `vendor.toml` /
`vendor.lock` state this truthfully and keep the offline conformance check green.

## Scope

**Covered:** the submodule ↔ Dependency-Channel reconciliation, the exact
manifest entries, the offline verification procedure, and the upgrade path if
upstream ever ships `bindings/react` in a release asset.

**Not covered:** the Aura adoption itself (brand knobs, import seam, FOUC) —
that is [ux/design-language.md](ux/design-language.md). The `grm-sync-deps` /
`grm-vendor-migrate` engine internals — those are the skill docs under
`.claude/skills/`.

## 1. The reconciliation

### 1.1 The upstream gap (design-language#858)

Aura's `v3.20` release asset bundle ships `css/`, `js/`, `dist/`, and
`templates/` but **not** `bindings/react`. The React adapter lives only in the
repository **source tree**. So a clean asset-bundle vendoring would leave
Harmony without `@aura/react` and without `jsx.d.ts`. Filed upstream as #858.

### 1.2 Resolution — git submodule pin (W2)

Harmony consumes Aura via a **git submodule** of `rhohn94/design-language`, so
the full source tree — including `bindings/react` — is present in-repo:

| Field | Value |
|---|---|
| repo | `rhohn94/design-language` |
| url | `https://github.com/rhohn94/design-language` |
| path | `vendor/aura` |
| channel | `stable` (the `v3.20` release channel) |
| pin (human) | `v3.20` |
| pinned SHA | `83c50b3fa0014433abd0ce783ae5911b8a29f1d4` |
| kind | `git-submodule` |
| consumed | `bindings/react` (imported as `@aura/react`) |

The pinned SHA is the **index gitlink** (mode `160000`) recorded for
`vendor/aura`, and matches the `source-sha` front-matter in
[ux/design-language.md](ux/design-language.md). `.gitmodules` carries the URL.

## 2. Why not an active `[deps.aura]` block

The `grm-sync-deps` engine's release-channel model **cannot express a submodule**,
and forcing it would be a false statement that breaks the offline check:

- `VALID_KINDS = {asset-bundle, vendored-crate, app-binary}` — there is **no
  `git-submodule` kind**. A `kind = "git-submodule"` entry is rejected at parse
  time (`kind must be one of …`).
- `artifact` is a **required** field validated against an archive-name regex
  (`*.tar.gz` / `*.tgz`). There is **no release artifact** carrying
  `bindings/react` to name (that is exactly #858).
- An active block would make `sync-deps --check` / `--self-test` attempt to
  resolve, fetch, and hash a non-existent asset → a spurious failure.

So an active `[deps.aura]` block would be **untrue** and would **break the
gate**. This is precisely the situation `grm-vendor-migrate` handles with its
**loud fallback**: when no published release matches the present bytes, it
writes a *fully-commented* `[deps.<name>]` stub (recording the resolved commit +
content sha, pinning nothing to a moving ref), writes **no** lock entry, and
exits 2 — *never silently pin to a moving ref*.

W19 applies that same honest shape, plus a dedicated informational
`[submodules.aura]` table that records the truthful pin.

## 3. What the manifests say

### 3.1 `vendor.toml`

- A **fully-commented** `[deps.aura]` stub (the vendor-migrate loud-fallback
  form) — parses to **zero active deps**, nothing pinned to a moving ref, with
  an inline note that the real mechanism is a submodule and why (#858).
- An active **`[submodules.aura]`** table recording `repo`, `url`, `channel`,
  `pin`, `sha`, `path`, `consumes`, `kind`, and `reason`. This table is **not**
  read by the `grm-sync-deps` engine (which consumes only `[deps.*]`); it is
  informational + offline-verifiable truth.

The canonical `[submodules.aura]` block:

```toml
[submodules.aura]
repo = "rhohn94/design-language"
url = "https://github.com/rhohn94/design-language"
channel = "stable"                 # v3.20 release channel
pin = "v3.20"                      # human-readable channel pin (W2)
sha = "83c50b3fa0014433abd0ce783ae5911b8a29f1d4"  # pinned gitlink (index mode 160000)
path = "vendor/aura"
consumes = "bindings/react"        # the React adapter Harmony imports via @aura/react
kind = "git-submodule"
reason = "design-language#858 — v3.20 release asset omits bindings/react; consumed from the source tree"
```

### 3.2 `vendor.lock`

`deps` stays `{}` (the engine's read/gate path sees no active dep, so
`sync-deps --check` / `--offline` exit 0). A parallel **`submodules`** block
records the resolved SHA so an offline verifier can confirm the vendored pointer
without a network call. `vendor.lock` `submodules.aura.sha` ==
`vendor.toml` `[submodules.aura].sha` == the index gitlink for `vendor/aura`.

## 4. Verification (offline)

Two independent, network-free checks; both must hold.

1. **Engine gate (release-asset deps):** `sync-deps --check` and
   `sync-deps --offline` see zero active `[deps.*]` and report *no drift* (exit
   0). This proves the manifests are internally consistent for the engine's
   surface and nothing is half-pinned.

   ```bash
   python3 .claude/skills/grm-sync-deps/sync_deps.py --check     # exit 0: no drift
   python3 .claude/skills/grm-sync-deps/sync_deps.py --offline   # exit 0: validates, zero network
   ```

2. **Submodule pin check (the manual `vendor-check` for a submodule dep):** the
   pin recorded in `vendor.toml` / `vendor.lock` must equal the index gitlink:

   ```bash
   git ls-tree HEAD vendor/aura | awk '{print $3}'   # 83c50b3fa0014433abd0ce783ae5911b8a29f1d4
   ```

   This is offline-verifiable: the gitlink is committed in this repo's tree,
   so the check needs no submodule checkout and no network.

The engine deliberately **does not** model the submodule, so step 2 is the
documented manual verification that substitutes for an engine `--check` of a
release-asset dep. Both are recorded here so a future reader (or a CI gate)
knows the conformance surface in full.

## 5. Upgrade path

If upstream closes [#858](https://github.com/rhohn94/design-language/issues/858)
by shipping `bindings/react` inside a `v3.x` release asset bundle, the submodule
can be migrated to a true Dependency-Channel dep:

1. Run `vendor-migrate --name aura --path vendor/aura` — it content-matches the
   release, writes an **active** `[deps.aura]` block, and locks via the real
   `grm-sync-deps` engine.
2. Drop the `[submodules.aura]` tables from `vendor.toml` / `vendor.lock` and
   remove the submodule (`.gitmodules` + gitlink).
3. Update [ux/design-language.md](ux/design-language.md) front-matter
   (`source: release-asset`) and this doc's §1.2 table.

Until then, the submodule remains the source of truth and this reconciliation
holds.

## References

- Upstream Aura gap: [design-language#858](https://github.com/rhohn94/design-language/issues/858)
- Aura adoption (import seam, brand knobs): [ux/design-language.md](ux/design-language.md)
- Dependency Channel consumer engine: `.claude/skills/grm-sync-deps/SKILL.md`
- Submodule → channel migration helper: `.claude/skills/grm-vendor-migrate/SKILL.md`
