# Release Planning — v0.2

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.2.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.2` |
| **Previous** | `v0.1` (Foundation — shipped, but the app rendered blank) |
| **Theme** | "Sight" — make the app actually render, and make the GUI self-verifying so a blank or crashed UI can never again pass a green build. First release of the GUI-and-cores program (v0.2–v0.7). |

**Context.** v0.1 built every screen but the app showed only a gradient
backdrop. Root cause was two defects the smoke gate could not see: (a) importing
the Aura runtime as a deferred ES module fired its internal `ready()` callback
before `Aura.icons` was defined, throwing `Cannot read properties of undefined
(reading 'names')` and aborting the entry module so React never mounted; (b) the
CSS cascade layer `harmony-theme` was registered before Aura's layers, so
Harmony's theme overrides lost the cascade. Smoke stayed green because it only
asserted an artifact file existed — it never verified the GUI rendered.

---

## 2. Major Features

### W22 — Blank-screen fix
- Load the Aura runtime as a classic, render-blocking `<head>` script (Vite
  plugin in `vite.config.ts`) so it executes during parse (`readyState ===
  "loading"`) and `Aura.ready()` defers to `DOMContentLoaded`; drop the deferred
  `import "@aura/runtime"` from `AuraProvider`.
- Declare the full CSS cascade-layer order once (`src/styles/layer-order.css`,
  imported first in `main.tsx`) with `harmony-theme` last → highest priority.

### W23 — Verified visual inspection + smoke gate
- `scripts/visual-inspect.mjs` captures `console` + uncaught `pageerror`s, walks
  every primary route (Library / Cores / Search / Settings), asserts each route
  mounted (React content in `#root`, shell chrome, expected text), screenshots
  each, and **exits non-zero on a blank/crashed GUI or any uncaught error**.
- `smoke` recipe now gates on that exit code (trailing `test -f` removed).
- Proven: hiding the JS bundle makes all routes report `FAIL` and exit 1.

### W24 — Mock IPC harness (closes T4)
- `scripts/mock-ipc.mjs` installs `window.__TAURI_INTERNALS__` with deterministic
  fixtures shaped like the real IPC DTOs, so screens render **populated**
  headlessly instead of "Could not load…" error states.
- `scripts/mock-ipc.test.mjs` guards the fixtures against DTO drift.

---

## 3. Implementation Strategy

A small, cohesive, foundational release. Per the Noir `release-phase-model: Auto`
dial, the integration master implemented all three items **in-session** on
`version/0.2` (branched off `dev`) rather than dispatching isolated work-item
worktrees — the items share `scripts/` and the design doc and are
diagnosis-coupled (W22 must land and be visible before W23/W24 can verify it).
Provisional v0.3–v0.7 are re-planned against the working app after this ships.

**Touched files (no overlap with parallel work — single-lane release):**
`vite.config.ts`, `src/theme/AuraProvider.tsx`, `src/main.tsx`,
`src/styles/layer-order.css`, `eslint.config.js`, `vitest.config.ts`,
`scripts/visual-inspect.mjs`, `scripts/mock-ipc.mjs`, `scripts/mock-ipc.test.mjs`,
`.claude/recipes.json`, `docs/design/runtime-verification-design.md`,
`docs/roadmap.md`.

---

## 4. Out of Scope for v0.2

Deferred to the provisional GUI-and-cores arc (v0.3–v0.7): real library grid /
core download UI / scan UI / launch + settings / controller + art polish — each
re-planned per release. Deferred to the **Backlog**: Enrichment & polish
(ScreenScraper, Familiar AI, controller-binding UI), systems beyond NES/SNES/N64,
and the notarized DMG (T2). **Not** screenshotting the real native Tauri window
(headless renders the SPA the shell loads — unchanged from v0.1).

---

## 5. Status Ledger

### Pass 1 — Sight (in-session, integration master)
| Branch | Design doc | Implemented | Reviewed | Merged into version/0.2 |
|---|---|---|---|---|
| W22 — blank-screen fix | ☑ | ☑ | ☑ | ☑ |
| W23 — verified visual inspection + smoke | ☑ | ☑ | ☑ | ☑ |
| W24 — mock IPC harness (T4) | ☑ | ☑ | ☑ | ☑ |

### Release
| Step | Status |
|---|---|
| `version/0.2` → `dev` merged | ☐ |
| `dev` → `main` promoted + `v0.2` tagged | ☐ |
| Pushed to origin (human-gated) | ☐ |
