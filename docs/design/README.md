# Design Docs

> **Up:** [↑ Docs root](../README.md)

> Template index — populate this as you add feature design docs. Agents use
> this file as their orientation entry-point; keep it current.

---

## Index

| Document | Area |
|---|---|
| `architecture-design.md` | System architecture and subsystem map |
| [dependency-channel-conformance.md](dependency-channel-conformance.md) | W19: Aura submodule ↔ Dependency Channel reconciliation — why Aura is vendored as a git submodule (not a release asset; design-language#858), the `vendor.toml`/`vendor.lock` `[submodules.aura]` truth + commented loud-fallback `[deps.aura]` stub, and the offline verification (engine `--check`/`--offline` clean + `git ls-tree` gitlink pin) |
| [release-planning-workflow-design.md](release-planning-workflow-design.md) | Release-planning Workflow: agent-tiering cost model, batched-vs-fanout sizing, read-only safety contract, `.claude/workflows/` convention |
| [onboarding-design.md](onboarding-design.md) | First-run onboarding interview, `.claude/grimoire-config.json` schema, sentinel lifecycle, `SKIP ONBOARDING` escape hatch |
| [work-paradigm-design.md](work-paradigm-design.md) | Work Paradigm file-swap architecture: neutral naming, three content sets (Supervised/Weiss/Noir), installer + switch skill contract, content-diff map, config schema v1→v2 |
| [write-capable-workflow-design.md](write-capable-workflow-design.md) | Write-capable Workflow tier: read-only vs. write-capable tiers, Noir gating, isolated-worktree parallel execution + master-merge model, safety rails, three execution variants (Efficient/Fast/Careful-Serial), v1.5 vet lessons |
| [hard-reset-design.md](hard-reset-design.md) | Hard-reset skill: framework vs. project-local file-class split, timestamped `.grimoire-archive/<ts>/` archive-never-delete, sentinel re-install + re-onboarding, config preserve-vs-reset, git-history separation, per-action confirmation guard |
| [token-efficiency-design.md](token-efficiency-design.md) | Scaffolding-wide token-efficiency methodology (v1.9 E1): Anthropic pricing mechanics (token classes, cache behavior, tier multipliers), ranked cost levers (output-min > cache-hit > model-tier > data-gated preamble trim), measurement protocol (`.jsonl` usage A/B, per-class report, break-even framing) — generalizes the v1.4 release-planning cost model |
| [model-effort-profiles-design.md](model-effort-profiles-design.md) | Selectable model/effort distribution profiles (E7) + task-name tier tags (E8): complexity bands, five starter profiles (Medium/High Effort/Low Effort/Efficient/Eco-Budget), one profile registry + config-field selector + single resolver, `[model/effort]` leading tag in spawned task names |
| [execution-profiles-design.md](execution-profiles-design.md) | Three orthogonal composable dials (v1.11 D1): work-paradigm (autonomy) × execution-strategy (dispatch posture — Fast/Efficient/Cheap-Slow) × model-effort-profile (tier); the speed/quality/cost triangle → dial mapping; S1-evidence-based Cheap-Slow (low fan-out, not literal solo); Careful-Serial kept as a write-capable-Workflow ordering concern; graduation (no schema bump) + onboarding decoupling; seams for E1–E4 |
| [cost-governance-design.md](cost-governance-design.md) | Cost governance (v1.15 D1): the optional `cost-governance` config block extending the three dials — token budget (#28: amount/reset-period/thresholds/`on-approach` modes, session+`.claude/cache/` periodic tracking, aggregate-only, no hard block); per-agent verbosity (#27: terse/normal/verbose, verbosity↔cost research conclusion, Eco→terse pin); peak-hour policy (#29: named windows/mode/tz, defer-and-reschedule, autonomous-only); token-limit observability + Noir checkpoint/resume (#12: usage observable post-hoc, cap signal uncertain, scheduled re-entry not in-run pause); priority-picker 2-of-3 dial mapping (#10); Steady Steward preset (#14: Noir×Cheap-Slow×Eco + low daily budget + one-item-per-wake, v1.16 wiring flagged) |
| [issue-tracker-design.md](issue-tracker-design.md) | Pluggable multi-target issue tracker (v1.12 D1): provider interface (list/get/create/update/close/label/search); normalized Issue object; `roadmap` + `github` backends; session-snapshot read cache (K=2 crossover); multi-tracker config block with audience routing; visibility model (same/separate/multiple-repo); `grm-feedback-to-issue` skill; Reporter agent taxonomy; onboarding Step 6 + §3.4; `grm-issue-tracker-switch` skill; all-consumer M1 migration plan |
| [agent-roles-design.md](agent-roles-design.md) | Canonical agent-role registry (v1.14 R1): the role taxonomy table (task agent, integration master, reporter + the five new roles Reviewer/Scout/Verifier/Triager/Researcher); per-role contracts (session type, context width, git/issue write surface, spawn rule, model/effort pin, per-paradigm Supervised/Weiss/Noir behaviour); the uniform spawn + return contract and no-git-write default for narrow roles; the role-vs-profile distinction; forward references to issues #21–#24/#26 and the install-doctor (#25, a skill not a role) |
| [autonomy-scheduling-design.md](autonomy-scheduling-design.md) | Autonomy scheduling & ops (v1.16 D1): default Noir wakeup (#13 — the cadence engine: three work-outstanding triggers → self-scheduled resume, `ScheduleWakeup` in-loop vs. `scheduled-tasks`/cron long-gap, composing with cost-governance §D/§E, on-wake §5-ledger-checkpoint re-read → continue; Supervised/Weiss keep human-driven resumption; push stays human-gated under a wakeup-resumed run); autonomous-push config (#16 — opt-in `autonomous-push.enabled` flag, default false, additive/no schema bump; `push-guard.sh` consults it as marker AND flag, ref-allowlist + denied-flag checks not relaxed; rails: marker still required, explicit-config-only never inferred, fail-closed, destructive flags never autonomous, documented risk); Daily Routines research (#11 — `schedule`/`scheduled-tasks` cost: yes, same account/budget, remote runner, worse cache profile; ranked shortlist of daily-cadence uses); worktree-isolation overhead research (#17 — keep isolation default even for Careful-Serial, narrow opt-in trivial-edit fast path, reject editing staging directly); completes the Steady Steward preset (#13 cadence + #16 landing + #11 channel) |
| [../grimoire/docs-organization-design.md](../grimoire/docs-organization-design.md) | Docs-by-audience reorg (v1.17 D1): audience audit of every file under `docs/`; the five-file `git mv` list into the new `docs/grimoire/` tier (incl. paradigm-managed [integration-workflow.md](../integration-workflow.md)); the per-file reference-update inventory C1 executes; the path-locked `release-planning-v*.md` exception (kept at `docs/` by `release-plan-guard.sh` + the release skill chain); the `.grimoire-source/` pristine generation-source folder for doc-generating skills, distinct from the `golden/` restore baseline |
| [feature-aware-sync-design.md](feature-aware-sync-design.md) | Feature-aware sync (v1.13 D1): feature manifest schema (`feature-id`/`introduced-in`/`detect`/`adopt`/`migrate`); `framework-version` marker in `grimoire-config.json`; post-merge adoption phase (delta computation, per-paradigm loop, idempotency, failure handling); `grimoire-config.json` exclusion; adoption vs. migration split; paradigm behaviour (Noir auto / Supervised+Weiss offer); github-issues playbook (F3 worked example) + cheap backfill entries; release-time authoring hook (F4); bake-upstream-URLs (U1); per-flavor notes |
| [ux-enhancements-design.md](ux-enhancements-design.md) | UX-tier enhancements (v1.18 D1): GUI-framework auto-detection (#4 — signal→stack detection table across package.json deps / config files / file extensions / native-mobile markers, deterministic precedence, confirm-not-assume; read-only, pre-fills `grm-workflow-bootstrap` Step 3 Q9 + reuses the Step 4 patch outcomes); component-library/theme-system layer (#5, flagship — two-tier `theme.md` tokens + `components.md` named recipes under `docs/design/ux/`, full schema, no-raw-values-in-components invariant, `grm-design-language-adapt` production under the draft→adopted/source-sha/selective-diff lifecycle, backward-compatible single-file projects; layer+schema ships now, concrete sets downstream); visual-regression for ux-demo (#6 — committed `screenshots/baseline/`, gitignored `diff/`, `visual-regression.json` manifest, pixel-primary + structural-fallback diff, opt-in GUI-only `grm-ux-demo-regress` skill `--accept`/`--check`, drift report with token-SHA correlation) |
| [merge-gate-quality-design.md](merge-gate-quality-design.md) | Merge-gate quality enforcement (v1.26 D1): config-gated quality gate added to `grm-release-phase-merge`; auto-spawned Reviewer under Noir; test-coverage and static-analysis hooks |
| [managed-project-tooling-design.md](managed-project-tooling-design.md) | Managed-project quality tooling (v1.27 D1): deterministic, CI-runnable quality tooling for managed projects complementing agent-driven `grm-coding-practices-audit` |
| [doc-assurance-design.md](doc-assurance-design.md) | Internal documentation assurance (v1.28 D1): self-checking docs via the `grm-doc-assurance` skill — flavor parity, design-doc layout, link integrity, docs-map validation, and skill-budget checks |
| [autonomy-hardening-design.md](autonomy-hardening-design.md) | Autonomy hardening (v1.30 D1): closes unattended-operation gaps from v1.22–v1.29 campaigns without relaxing safety rails |
| [issue-label-taxonomy.md](issue-label-taxonomy.md) | Issue label taxonomy (v1.31 D1): recommended label set seeded at onboarding for GitHub trackers; audience routing convention |
| [rust-quality-enforcement-design.md](rust-quality-enforcement-design.md) | Rust quality enforcement (v3.16 D1): clippy, rustfmt, cognitive-complexity, module structure, and audit-hint coverage for managed Rust projects |
| [html-css-quality-enforcement-design.md](html-css-quality-enforcement-design.md) | HTML/CSS quality enforcement (v3.17 D1): enforceable HTML and CSS standards with full audit-hint coverage |
| [architecture-fitness-design.md](architecture-fitness-design.md) | Architecture-fitness enforcement (v3.18 D1): deterministic machine-readable fitness functions for dependency-direction, layering, and boundary constraints |
| [dry-duplication-enforcement-design.md](dry-duplication-enforcement-design.md) | DRY and duplication enforcement (v3.19 D1): promotes duplication from a reported metric to a gate-able dimension with concrete remediation path |
| [modularization-metrics-design.md](modularization-metrics-design.md) | Modularization metrics (v3.20 D1): coupling, instability, and module-size metrics added to the managed-project quality surface |
| [token-efficiency-enforcement-design.md](token-efficiency-enforcement-design.md) | Token-efficiency enforcement (v3.21 D1): applies and enforces the v1.9 token-efficiency methodology — skill-footprint budget, enforcer dial, and remediation playbook |
| [ux-design-language-design.md](ux-design-language-design.md) | UX design language design: per-project design-language adaptation framework, two-tier token+component schema, upstream source integration |
| [library-import-design.md](library-import-design.md) | v0.12 "Curator": ROM import (drag-drop + native file picker) into the managed Games dir, auto-metadata on add (cover art + Wikipedia description), manual refresh, and the curated links-only ROM-site download providers |
| [console-browse-design.md](console-browse-design.md) | v0.12 "Curator": the "By Console" browse + detail view, the static console catalog (name/maker/gen/year/Wikipedia), per-console media cache, and the bundled per-console title catalog (libretro-database, names-only, embedded) |
| [presentation-shell-design.md](presentation-shell-design.md) | v0.14 "Lounge": wiring the W14 controller stack into the shell + library (spatial nav, global Back), the OS-fullscreen toggle (F11 + sidebar button), and the per-console CPU/GPU/RAM hardware-specs table |
| *(add rows as docs are created)* | |

### UX tier (`docs/design/ux/`)

| Document | Area |
|---|---|
| [ux/design-language.md](ux/design-language.md) | Per-project UX design language: source mode, local tokens, component map, adaptation acceptance |
| [ux/theme.md](ux/theme.md) | Design token tier: color, typography, spacing, and surface tokens |
| [ux/components.md](ux/components.md) | Component recipe tier: named component patterns referencing theme token paths |
| [runtime-verification-design.md](runtime-verification-design.md) | Visual-inspection CLI (`gui-visual-inspection-cli`, W18) + CI-safe smoke: headless render of the built web UI to a PNG screenshot + DOM dump, `inspect`/`smoke` recipe targets, static fallback |

> **See also** (scaffold-level, not per-feature): cross-cutting
> [coding standards](../coding-standards.md) and
> [architecture guidelines](../architecture-guidelines.md) live under `docs/`.

---

## Conventions

### File naming
- All design docs live in `docs/design/`.
- Filenames are kebab-case: `{feature-name}-design.md`.
- Use the **`grm-design-doc-scaffold`** skill to create a new doc.

### Subdir convention (`docs/design/{tier}/`)
- `docs/design/` may use subdirectories to organise design docs by tier when a
  group of related docs warrants its own home. Flat-vs-subdir is a per-tier
  judgement call: keep a one-off doc flat; promote a tier to a subdir once it
  has (or will have) more than one doc.
- The **UX tier** under `docs/design/ux/` is the first canonical sub-tier. Its
  anchor is [`ux/design-language.md`](ux/design-language.md), the per-project UX
  design-language authority; additional UX-tier docs (component maps, theming
  notes) live alongside it as the project grows.

### House layout

Every design doc follows this structure:

```
# {Feature title}

## Motivation
Why are we building this?

## Scope
What this covers and explicitly does not cover.

## Design
Approach, key types/components, cross-links to sibling docs.

## Acceptance
Testable checklist — one bullet per verifiable behaviour.

## Open questions
Unresolved decisions. Delete this section if empty.

## Follow-ups
Deferred work for a future release.
```

### Cross-linking
- Reference sibling docs by relative path: `[auth](auth-design.md)`.
- Never duplicate content across docs — link instead.
- When a subsystem is referenced by name in the architecture doc, the
  corresponding feature doc should use the same name.

### Lifecycle
- A design doc is created on a **work branch** (your spawned worktree) before
  implementation starts.
- The **`grm-design-doc-scaffold`** skill creates the file and wires the index.
- The doc evolves alongside the code; **Open questions** shrink as decisions
  are made; **Follow-ups** capture deferred work.
- When a feature is removed or replaced, mark the doc deprecated at the top
  rather than deleting it.
