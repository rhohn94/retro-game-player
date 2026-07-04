# Release Planning — v0.30

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.30.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.30` |
| **Previous** | v0.29 Craft (CRT filter, per-core settings, perf tooling, keyboard a11y, play-path integration tests) |
| **Theme** | "Passport" — ready for hands that aren't the developer's. Gatekeeper-clean install for anyone, not just the dev machine. |

Investigation at planning time found the roadmap's second named v0.30 item —
license/GPL compliance follow-through (issue
[#26](https://github.com/rhohn94/harmony/issues/26)) — **already shipped in
v0.23**: `LICENSE`, `THIRD-PARTY-NOTICES.md`, `package.json`, and
`src-tauri/Cargo.toml` already declare `GPL-3.0-only`, and the UnRAR blob is
already removed. So v0.30's real scope is the one remaining item: notarized
DMG distribution.

---

## 2. Major Features

### W300 — Notarized, stapled Developer-ID DMG (#27)

**Description:** Wire Developer-ID signing, hardened runtime + entitlements,
and Apple notarization (`notarytool`) + stapling into the release build path,
so a release DMG passes Gatekeeper and launches clean on a fresh Mac with no
override. Today's `tauri.conf.json` `bundle` block has no signing/
notarization configuration at all.

**Acceptance criteria:**
- A design doc exists covering signing-identity sourcing, entitlements,
  hardened runtime, the `notarytool` submission/staple flow, and
  credential/secrets handling.
- The build path (Tauri bundle config + release script/recipe) applies
  Developer-ID signing + hardened runtime + entitlements when a signing
  identity is present, and documents what's required to supply one.
- Notarization submission + stapling is wired into the release path with
  a documented credential-setup story (env vars / keychain profile).
- An automated `spctl -a -t open --context context:primary-signature` check
  is added to the release verification step.
- The doc/checklist is explicit about what could **not** be verified in this
  environment (no real Apple Developer ID credentials, no clean secondary
  Mac) versus what shipped as working, tested plumbing — same honest-gap
  pattern as v0.29's #35/#36.

**Branch:** `feat/w300-notarized-dmg`
**Design doc:** `docs/design/notarization-distribution-design.md` (new —
scaffolded on the work branch per house convention).

---

## 3. Parallel Implementation Strategy

Single work item, single pass — no conflict map needed.

| Pass | Branch | Touches |
|---|---|---|
| 1 | `feat/w300-notarized-dmg` | `src-tauri/tauri.conf.json`, new entitlements plist, release/build scripts, `docs/design/notarization-distribution-design.md`, release-doc checklist |

---

## 4. Out of Scope for v0.30

- **Metadata enrichment** (#24) — roadmap Backlog tags it "candidate for
  v0.30" but it doesn't match the Passport (distribution) theme; stays
  unscheduled roadmap backlog.
- **Actually enrolling in / paying for an Apple Developer Program
  membership, or managing the real signing certificate** — human/maintainer
  action; this release only prepares the wiring and docs for it.
- **Live, real-credential notarization run and clean-machine Gatekeeper
  verification** — deferred to a human step post-merge; not reachable by an
  agent without real Apple Developer-ID credentials or a clean secondary
  Mac. Tracked as a follow-up, same pattern as v0.29 #35.
- **Filed low-priority carryover issues** #33 (core-options probe
  robustness), #34 (keyboard a11y follow-ups), #35 (on-device shader-cost
  trace), #36 (perf-log growth/postMessage origin) — none tagged `v0.30` by
  any prior plan; remain roadmap backlog.
- No `Grimoire-Requirement`-tagged issues were open at planning time (verified
  via the mandatory tracker read); nothing to schedule or justify-and-defer
  under that rule.

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.30 |
|---|---|---|---|---|
| `feat/w300-notarized-dmg` (W300) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

(empty at start; populated by release-phase-merge as branches land)
