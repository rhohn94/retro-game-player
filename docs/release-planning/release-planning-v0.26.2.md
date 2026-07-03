# Release Planning — v0.26.2

> status: agreed
> Hotfix release — single-item lane, abbreviated ritual. Captures the scope
> and ledger for v0.26.2. Archive into `version-history.md` when it ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.26.2` |
| **Previous** | v0.26.1 (native-play A/V clock hotfix) |
| **Theme** | Hotfix — no images anywhere in the app (user-reported 2026-07-03). W269's rename migration moved the app-support directory (`com.harmony.app` → `com.retro-game-player.app`) but never rewrote DB rows storing **absolute** paths into it. On a migrated machine, 28 rows dangle: `console_meta.image_path` (all 20 console photos), `games.art_path` (2), `art_cache.path` (2, the v0.26 art tiers), `cores.installed_path` (4). Stale image paths are doubly dead — the files moved *and* the old prefix falls outside the asset-protocol scope, which resolves `$APPDATA` against the new identifier. Native play kept working because the launch path re-resolves the core file under the live root. Config dir and all other tables verified clean. |

Defect record: this document + `app-infrastructure-design.md` §Rename →
"v0.26.2 (W271)". (Issue filing remains classifier-blocked —
rhohn94/grimoire-framework#221.)

---

## 2. Major Features

### W271 — Post-rename DB path repair

New migration `src-tauri/src/db/migrations/011_repair_renamed_app_paths.sql`:
rewrite the identifier path segment `/com.harmony.app/` →
`/com.retro-game-player.app/` in `games.art_path`, `art_cache.path`,
`console_meta.image_path`, and `cores.installed_path`, each guarded by
`LIKE '%/com.harmony.app/%'` — a no-op on fresh installs, idempotent on
repaired data, correct on both `fs::rename`d and copy-fallback migrations
(the files exist under the new root either way). Follows the established
migration-file pattern and runner; unit tests seed old-prefix rows and assert
the rewrite (plus no-op on clean rows and NULL handling).

- **Acceptance:** all gates green (vitest, cargo test, typecheck, lint,
  clippy, build, `recipe.py smoke`); migration covered by tests for
  rewrite / clean-row no-op / NULL columns; **real-app verification that
  images render again** (asset protocol is a documented smoke blind spot —
  v0.13 precedent: verify in the running app, not just headless).
- **Branch:** `fix/w271-rename-db-path-repair`
- **Design:** `app-infrastructure-design.md` §Rename → "v0.26.2 (W271)"
  (updated).

---

## 3. Parallel Implementation Strategy

### Pass 1

Single item, single phase — `fix/w271-rename-db-path-repair` branches from
`version/0.26.2`, backend-only (one SQL migration + tests).

No conflicts — sole branch in the lane.

---

## 4. Out of Scope for v0.26.2

- Converting art/core path columns to app-support-relative storage (the
  durable fix that makes future identifier changes safe) — recorded in the
  design doc as a v0.29 Craft candidate.
- Renaming `harmony.db` / the `deployed-apps/harmony/` fleet subtree —
  explicitly out of scope since W269.
- Everything scheduled for v0.29 "Craft".

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.26.2 |
|---|---|---|---|---|
| `fix/w271-rename-db-path-repair` (W271) | ☑ | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- None yet.
