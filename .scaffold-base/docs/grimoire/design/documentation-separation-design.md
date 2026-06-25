# Documentation Separation (internal vs. consumer-facing)

> **Up:** [↑ Grimoire design index](README.md)

> v3.39 "Bulkhead", DS-1 — the design spine. This is the canonical design the
> migration lanes (DS-2 canonical, DS-3 copilot, DS-4 root, DS-5 closeout) build
> to. It is itself an inhabitant of the new `docs/grimoire/design/` tier, so it
> demonstrates the separation it specifies. **Design only** — no files move and
> no references are rewritten here; the moves and rewrites are the later lanes.

## Motivation

Grimoire ships two flavor scaffolds (`claude-code/`, `copilot/`). A consumer who
installs a flavor receives Grimoire's own **framework-internal design specs**
(~25 `*-design.md` files describing how the framework itself is built) mixed into
their `docs/design/` — the tier that should hold *their own* project's design.
The same leak drags framework-development provenance (issue numbers, internal
version codes, dogfooding asides, canonical-first/flavor-parity instructions)
into prose docs a consumer reads as if it were guidance for *their* project.

The leak is real and flows through **two ship gates** (audit-verified, treat as
ground truth — see §Audit evidence). The `.gitattributes` `export-ignore` rule
that *appears* to gate this is a **no-op** on the real build path. Net effect: a
consumer's `docs/design/` is polluted and their reading surface is noisy.

This release establishes a clean bulkhead: framework-internal docs stay home and
never ship; consumer-facing docs ship genericized.

## Scope

Covers: the target two-tier architecture; the audience-classification rule and
the explicit canonical move list; the four cross-reference path forms and the
per-form rewrite rule; the two-gate exclusion mechanism (precise + implementable)
plus the `.gitattributes` correction; the content-separation rules (what internal
prose to strip and where it goes); the downstream migration strategy for an
already-polluted consumer; the supersession record; and the edge-case decisions.

Does **not** cover (executed in later lanes): performing any move, rewriting any
reference, editing any tooling, stripping any prose, or adding the supersession
pointer to the head of a superseded doc (those docs relocate, so their pointer
edit lands in the lane that relocates them). Also out of scope: changing the
wiki-hierarchy conventions themselves (we relocate + re-tier; conventions are
unchanged), a config/schema bump, auto-running the downstream reconcile, and a
full audit of shipped `SKILL.md` prose. See the planning doc §4.

## Design

### 1. Target architecture

Two audiences, two tiers. The principle, stated crisply:

> **Internal-to-building-Grimoire stays; consumer-facing ships.**

| Tier | Contents | Ships to consumers? |
|---|---|---|
| **Framework-internal** — `docs/grimoire/**` | Framework design specs (`docs/grimoire/design/`), framework-dev study artifacts, the root-only maintenance home | **No** — excluded at both ship gates |
| **Consumer-facing** — `docs/` top level + `docs/design/` (project-own design + `docs/design/ux/`) | A consumer's own project docs and design; the genericized framework reference a consumer needs | **Yes** — ships, genericized |

Two deliberate exceptions inside `docs/grimoire/` that **stay shipped** (a
consumer needs them): `docs/grimoire/README.md` (the tier index) and the
consumer-facing **wiki-convention authority** (see §6 for where it lives).

### 2. Audience classification rule + canonical move list

**Classification rule** (each flavor lane applies it to its *own* file set):

- A `docs/design/*-design.md` (or `*-taxonomy.md` / `*-candidates.md`) that
  describes **how Grimoire the framework works** = framework-internal →
  **move** to `docs/grimoire/design/`.
- A `docs/design/` doc describing **the consumer's own project** (and the
  `docs/design/ux/**` subtree, which is a project-own UX adaptation) =
  project-own → **stays**.
- `docs/design/README.md` is reset to the empty project-own template (a consumer
  populates it with *their* design docs).

**Canonical move list** — the 27 framework spec files in `claude-code/docs/design/`
(claude-code has no project of its own, so all 27 specs are framework-internal):
`agent-roles`, `architecture-fitness`, `autonomy-hardening`,
`autonomy-scheduling`, `cost-governance`, `grm-doc-assurance`,
`dry-duplication-enforcement`, `execution-profiles`, `feature-aware-sync`,
`grm-hard-reset`, `html-css-quality-enforcement`, `issue-label-taxonomy`,
`grm-issue-tracker`, `managed-project-tooling`, `merge-gate-quality`,
`model-effort-profiles`, `modularization-metrics`, `grm-onboarding`,
`release-planning-workflow`, `rust-quality-enforcement`, `token-efficiency`,
`token-efficiency-enforcement`, `ux-design-language`, `ux-enhancements`,
`work-paradigm`, `workflow-candidates`, `write-capable-workflow` (the
`*-design.md` / `*-taxonomy` / `*-candidates` files) → all move to
`docs/grimoire/design/`. `docs/design/README.md` → reset to empty template;
`docs/design/ux/` (README, components, design-language, theme) → **stays**.

Per-flavor counts differ — root has ~67 design docs, copilot ~24 — but the same
**rule** applies. The move list is **per-flavor by membership**: a lane moves
the framework specs that physically exist in *its* flavor, not a fixed name list
(see §Edge cases — `web-app-support-design.md` and `ux-design-language-design.md`
are present in some flavors and absent in others).

### 3. The four cross-reference path forms + per-form rewrite rule

A blanket find/replace of `docs/design/X-design.md` → `docs/grimoire/design/X-design.md`
is **WRONG**: relative links depend on the *directory depth* of the file that
contains the link, and moving the target (and sometimes the source) changes that
depth. Apply per-form rules. (Old target `docs/design/X-design.md` → new target
`docs/grimoire/design/X-design.md`, one directory deeper.)

| Form | Where it appears | Old → New rewrite |
|---|---|---|
| **(a) same-directory** — link between two design docs that both move | inside a moved `*-design.md` linking a sibling moved doc | unchanged: `[..](sibling-design.md)` — both end up in `docs/grimoire/design/`, still siblings. **Do not** prepend any path. |
| **(b) docs-root-relative** — link expressed relative to `docs/README.md` (e.g. in the docs map) | `docs/README.md`, tier indexes | `design/X-design.md` → `grimoire/design/X-design.md` (the docs-map regen handles this). |
| **(c) one-up `../`** — a moved design doc linking up to a `docs/`-level doc | inside a moved doc: `[..](../features.md)` (was one `../` from `docs/design/`) | gains one level: `../features.md` → `../../features.md` (now two dirs deep at `docs/grimoire/design/`). Conversely a link from `docs/` *down into* a moved doc becomes `grimoire/design/X-design.md`. |
| **(d) skill/script/hook pointer** — a non-doc file naming a design-doc path as a literal string | `SKILL.md`, `*.py`, `*.sh`, `*.js`, `CLAUDE.md`, `AGENTS.md` | rewrite the literal `docs/design/X-design.md` → `docs/grimoire/design/X-design.md`. These are repo-root-relative literals (not markdown relative links), so depth does not apply — a literal swap is correct **and** required for the no-excluded-pointer invariant (§5). |

**Verification per lane:** `grm-doc-assurance` `links` (relative-link integrity)
must be clean for the lane's flavor after rewrite; the docs-map is regenerated
(`doc_assurance.py docs-map --write-map`).

### 4. Two-gate exclusion mechanism

Both gates currently leak (see §Audit evidence). The fix excludes the
framework-internal subset from each.

**Gate A — packaging (`build_distributables.py`).** `_collect_files()` rglobs the
whole flavor tree and excludes only path **component names** in
`EXCLUDED_COMPONENTS`. A multi-segment prefix like `docs/grimoire` is *not*
matched by a component-name check. The fix adds a **path-PREFIX** exclusion:

- Introduce a new set, e.g. `EXCLUDED_PATH_PREFIXES`, holding the posix prefixes
  of the exclusion set (§ below).
- In `_collect_files()`, after computing the flavor-relative path `rel`, skip the
  file when `rel.as_posix().startswith(prefix)` for any prefix in the set.
- Keep `EXCLUDED_COMPONENTS` for the existing component-name cases; the new
  prefix check is additive, not a replacement.

**Gate B — consumer sync (`sync-from-upstream.sh`).** `is_excluded()` shields
only `docs/roadmap.md`, `docs/design/README.md`, and a few basenames. Framework
`*-design.md` are not shielded, so they 3-way-merge into a consumer's
`docs/design/`. The fix adds an `is_excluded()` case for the framework-internal
subset — match the same `docs/grimoire/<excluded-prefix>` paths so they are never
merged into a consumer tree.

**`.gitattributes` correction.** The existing
`docs/grimoire/** ... export-ignore` rule is a **no-op** on the real build path
(`export-ignore` only affects `git archive`, which `build_distributables.py` does
not use). It is misleading. The lane must either remove it or replace its comment
to state plainly that exclusion is enforced by the two code gates above, not by
`export-ignore` — so a future maintainer does not trust a rule that does nothing.

**The exclusion set (exact).** Exclude from **both** gates:

- `docs/grimoire/design/**` (all framework design specs)
- the four framework-dev study artifacts: `docs/grimoire/feature-playbook-validation.md`,
  `docs/grimoire/issue-tracker-cost-spike.md`,
  `docs/grimoire/issue-tracker-cost-validation.md`,
  `docs/grimoire/sync-flow-audit.md`
- `docs/grimoire/maintaining-grimoire.md` (root-only internal home)

**Keep shipped** (do **not** exclude): `docs/grimoire/README.md` and the
consumer-facing wiki-convention authority (§6).

**CRITICAL invariant.** **No shipped pointer may reference an excluded doc.** Any
shipped `CLAUDE.md`, `grm-repo-reference` doc-location map, or shipped `SKILL.md`
that today names an excluded doc must be retargeted (to the shipped authority, or
dropped) in the lane that owns that file. A shipped pointer into an excluded doc
would dangle in a consumer install. This is a per-lane done-criterion and a DS-5
closeout sweep.

### 5. Content-separation rules

Beyond *files*, internal-facing **prose** embedded in otherwise-shipped docs must
be stripped and factored into the root-only internal home
(`docs/grimoire/maintaining-grimoire.md`). Internal-facing prose is anything that
documents **building/maintaining Grimoire itself** rather than using it:

- Framework issue numbers (e.g. `#126`) and internal version codes (e.g. `v8.40`).
- "Dogfood model" / "we dogfood the workflow" asides.
- Canonical-first / flavor-parity / golden-re-baseline maintenance instructions.
- "framework source" breadcrumbs that orient a *maintainer*, not a consumer.

**Known concrete instances to fix in the later lanes** (named so they are not
missed):

- The **framework-source breadcrumb** in `docs/README.md`.
- The `#126` / `v8.40` / "dogfood model" provenance in `integration-workflow.md`
  — edited at its **paradigm source** `.claude/paradigms/*/integration-workflow.md`
  and re-rendered (that file is paradigm-managed; editing only the rendered copy
  is wrong because `grm-work-paradigm-switch` would overwrite it).
- The `grm-sync-from-source` maintainer skill **mislisted as a consumer feature** in
  `docs/features.md` (it is a maintainer tool, not a consumer feature).

Where it goes: the extracted maintenance prose lands in
`docs/grimoire/maintaining-grimoire.md` (root-only; DS-4 populates the skeleton
DS-1 creates).

### 6. Where the wiki-convention authority lives (ship-vs-internal decision)

`docs-organization-design.md` today holds **two distinct concerns**: (1) the
v1.17 docs-by-audience audit + move list + `.grimoire-source/` design — pure
**framework-development history**; and (2) a "Wiki hierarchy & relative links"
section that is the **canonical convention authority** a consumer needs and that
`grm-repo-reference` + `CLAUDE.md` route to.

**Decision (chosen over the default).** Make `docs-organization-design.md`
**framework-internal** (it is a historical framework-dev artifact — it documents
a past reorg and a source-folder design, not consumer guidance) and relocate the
**consumer-facing wiki-convention authority** to a shipped home. The shipped home
is **`docs/grimoire/README.md`** (which stays shipped and is already the
`docs/grimoire/` tier index) — the convention section is factored there as a
"Wiki hierarchy & relative links" subsection (or a short shipped leaf the README
links, if size presses against the 6 KB lean-index cap; the migration lane
decides based on the rendered size, keeping the README lean).

**Rationale.** The default (keep the whole `docs-organization-design.md` shipped,
factor only its history out) would ship a doc whose bulk is a framework-dev audit
that a consumer never needs, just to carry one convention section. Extracting the
convention section into the already-shipped tier index is cleaner: the authority
travels with the index a consumer already reads, and the historical audit becomes
properly internal. **Retarget obligation:** `grm-repo-reference` and `CLAUDE.md`
pointers that today route to `docs-organization-design.md §Wiki hierarchy` must be
repointed to the new shipped home (per §4's no-excluded-pointer invariant). The
migration lanes (DS-2 canonical, then DS-3/DS-4) execute this; DS-5 sweeps it.

> **Note for the migration lane:** `docs-organization-design.md` sits directly
> in `docs/grimoire/` (not under `docs/grimoire/design/`), so the §4 exclusion
> set must explicitly add it alongside the four study artifacts once the
> convention section is extracted.

### 7. Downstream migration strategy

A consumer who already received framework `*-design.md` in their `docs/design/`
(via Gates A+B before this release) must be reconciled — but **never** blind
delete. The mechanism:

- A `feature-manifest` **migrate row**, **NEVER-AUTO-RUN** (it reconciles a
  consumer's already-polluted tree; that stays a human/master decision via
  `grm-docs-migrate`, per planning §4).
- The row **archives-then-prunes**: it first copies the stranded framework
  `*-design.md` under an archive path (e.g. `.grimoire-archive/<ts>/`), then
  removes them from `docs/design/`. Archive first, never silent delete.
- It bumps the manifest version **51 → 52** across all four manifest copies
  (root + the three flavor copies). This is the existing migrate mechanism, not a
  schema change. (Added by DS-5 at closeout.)

### 8. Edge-case decisions

| File / case | Classification | Decision + rationale |
|---|---|---|
| `ux-design-language-design.md` | framework spec | **moves** to `docs/grimoire/design/` — physically resolves its name-collision with the project-own `docs/design/ux/design-language.md`. Present in root + claude-code, absent in copilot (apply per-flavor membership). |
| `web-app-support-design.md` | framework | **moves** — present in root only (absent in claude-code + copilot per audit); the lane moves it only where it exists. |
| `docs/design/ux/**` (README, components, theme, design-language) | project-own | **stays** — a project's own UX adaptation, consumer-facing. |
| `maintaining-grimoire.md` | framework maintenance | **root-only** — never in `claude-code/` or `copilot/`, never shipped; in the exclusion set. |
| `workflow-candidates.md` / `issue-label-taxonomy.md` | framework | **move** — framework spec artifacts (non-`*-design.md` names but framework-internal). |
| `docs-organization-design.md` | framework-dev history | **becomes internal** + convention section extracted to shipped `docs/grimoire/README.md` (§6). |

### 9. Phase / lane map

Consistent with the planning doc §3 (authoritative — this is a brief reference):

- **DS-1** (this doc) — design spine + `docs/grimoire/design/` tier index + the
  root-only `maintaining-grimoire.md` skeleton.
- **DS-2** — canonical `claude-code/` reference migration (relocate, rewrite
  refs, retarget tooling, apply both gate exclusions, strip prose), proven green
  first.
- **DS-3** — `copilot/` flavor mirror; **DS-4** — root dogfood mirror (parallel,
  disjoint dirs). DS-4 populates `maintaining-grimoire.md`.
- **DS-5** — master closeout: re-snapshot both golden baselines, add the
  feature-manifest migrate row (51→52), `doc-assurance --strict` full-parity
  gate, release consistency.

See the v3.39 release-planning doc (root flavor) for the authoritative lane
contracts, conflict map, and merge order.

## Audit evidence (ground truth)

Two ship gates leak framework docs into consumers' `docs/design/`:

- **Gate A — packaging:** `build_distributables.py`. `discover_flavors()` only
  packages dirs with a `.grimoire-flavor` marker (only `claude-code/` + `copilot/`
  have it; root never ships). `_collect_files()` rglobs the whole flavor tree and
  excludes only component names in
  `EXCLUDED_COMPONENTS = {".git",".DS_Store","__pycache__",".scaffold-base",".scaffold-sync-backup","dist"}`
  — **no docs filter**, and a multi-segment prefix is not matched by a
  component-name check (hence the prefix-exclusion fix in §4).
- **Gate B — consumer sync:** `sync-from-upstream.sh` `is_excluded()` shields only
  `docs/roadmap.md`, `docs/design/README.md`, plus a few basenames; framework
  `*-design.md` 3-way-merge into consumers' `docs/design/`.
- **`.gitattributes`:** `docs/grimoire/** ... export-ignore` is a **no-op** on the
  real build path (`export-ignore` only affects `git archive`, which the build
  does not use) — misleading; corrected in §4.
- **Fresh-install seeding** is from GOLDEN
  (`.claude/skills/grm-workflow-bootstrap/golden/`), which seeds only `docs/README.md`,
  `docs/grimoire/README.md`, `docs/design/ux/design-language.md`. Consumers get
  framework design docs **only** via Gates A+B — so excluding the internal set
  from both gates fully stops the leak.

**Tooling later lanes retarget** (document the targets; do not edit here):
`doc_assurance.py` (`check_design_layout` glob, `DOCS_PARITY_ALLOW`, monolith /
lean-index exempt lists), `qa_select.py` (design-doc regex), `grm-repo-reference`
(doc-location map), `stealth_scrub` (`MANAGED_PREFIXES`) + `stealth-guard`
(`DEFAULT_MANAGED`), and the ~30 documentary doc-path pointers in scripts/hooks.

## Supersession

This design **supersedes** two prior binding decisions, justified by the
two-gate leak evidence above and the user's separation requirement:

- **v1.17** — `docs-organization-design.md` §Classification: "shared design docs
  → `docs/design/` stays exactly where it is." That rule predates the leak
  audit; framework specs are **not** genuinely shared — they describe building
  Grimoire and pollute a consumer's design tier. Superseded.
- **v3.8** — `footprint-reduction-design.md` §Non-goals: "Changing `docs/design/`
  … Design docs are genuinely shared (project + framework); they stay where both
  audiences expect them." The leak audit disproves "genuinely shared" for the
  framework subset. Superseded.

A one-line "superseded by `documentation-separation-design.md` §Supersession"
pointer will be added to the head of each superseded doc — that edit lands in the
migration lane that relocates the doc (DS-2 for the canonical copies, DS-4 for
root), not here, because those docs relocate.

## Acceptance

- This doc exists at `docs/grimoire/design/documentation-separation-design.md`,
  follows the house section layout, with a breadcrumb + an index entry.
- States: target architecture; classification rule + full move list; the four
  path-form rewrite rules; the two-gate exclusion mechanism (+ `.gitattributes`
  correction); content-separation rules; downstream migration strategy.
- Records the v1.17 + v3.8 supersession explicitly.
- The new `docs/grimoire/design/` tier is BFS-reachable from `docs/README.md`
  (the index links it; `docs/grimoire/README.md` links the new tier index) and
  introduces no new `grm-doc-assurance` hierarchy / relative-link / reachability
  findings for the DS-1 files.

## Follow-ups

- A full audit of shipped `SKILL.md` prose for internal-facing instruction is a
  separate follow-up if warranted (planning §4); this release scopes content
  separation to prose **docs**.
- The Codex-flavor epic (#114–#125) shifts to v3.40–v3.42 because v3.39 took its
  slot (planning §4).
