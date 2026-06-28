# Release Planning — v0.3

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.3.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.3` |
| **Previous** | `v0.2` (Sight — app renders + self-verifying visual inspection) |
| **Theme** | "Resonance" — adopt the Aura design language fully and drive Harmony's UI from Aura design tokens rather than ad-hoc CSS. Second release of the GUI-and-cores program (v0.2–v0.7). |
| **Ticket** | [#1](https://github.com/rhohn94/harmony/issues/1) |

**Context.** v0.2 made the app render and self-verify. The UI works but is
visually inconsistent: ~25–30 hard-coded px values, ~8–10 `rgba(...)` colour
fallbacks that shadow real Aura tokens, magic layout constants in `App.tsx`,
and no Harmony typography/spacing token aliases. The Aura submodule is pinned at
`v3.20` (SHA `83c50b3`). This release reconciles the pin, replaces hard-coded
values with Aura tokens, and introduces a small, named Harmony token layer for
the values Aura does not own (hero sizes, tile geometry, provider chips).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W31** | Aura pin reconciliation + token-layer scaffolding | `vendor.lock` confirms/records the resolved Aura SHA on the `v3.20` channel; a documented Harmony token set (`--harmony-*`) is declared in the `harmony-theme` layer for values Aura does not provide (hero/detail title sizes, caption size, tile geometry, provider-chip fills, layout gutters). |
| **W32** | Tokenize hard-coded values | No hard-coded hex/px magic number remains in Harmony component styles where an Aura or Harmony token exists. `library.css`, `cores.css`, and inline `style=` in `App.tsx`/`SettingsPage.tsx`/`SearchPage.tsx` all reference tokens. `rgba(...)` fallbacks that shadow Aura tokens are removed. |
| **W33** | Verified token adoption | `node scripts/visual-inspect.mjs` passes on all four routes with the new tokens applied; captured screenshots show the Aura theme applied consistently (no regression vs v0.2). A lightweight guard test asserts no banned hard-coded colour literals remain in tokenized files. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). The work is tightly-coupled CSS/theme
editing that would conflict if parallelized, so the integration master
implements it directly on `version/0.3` in dependency order: W31 (establish the
token layer) → W32 (consume tokens across the components) → W33 (verify +
guard). Each work item is committed atomically. The full gate
suite (typecheck, lint, tests, cargo check, smoke with visual inspection) must
pass before merge.

## 4. Out of scope

- New screens or features (deferred to v0.4–v0.7).
- Motion/animation work (that is v0.4's theme).
- Swapping bespoke components to `<aura-*>` custom elements wholesale — only
  done where it is a clean, low-risk win; broad element migration is a backlog
  item, not a v0.3 commitment.
- Bumping the Aura pin to a newer channel than `v3.20` (reconcile the existing
  pin only; a channel bump is its own release-gated change).

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W31 — token-layer scaffolding | version/0.3 (in-session) | ☐ | |
| W32 — tokenize hard-coded values | version/0.3 (in-session) | ☐ | |
| W33 — verified token adoption | version/0.3 (in-session) | ☐ | |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.3 → dev | ☐ | |
| dev → main promoted + tagged v0.3 | ☐ | |
| pushed to origin | ☐ | HUMAN-GATED — do not push without explicit go |
