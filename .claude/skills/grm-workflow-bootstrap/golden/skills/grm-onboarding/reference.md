# Onboarding — reference
Loaded on demand by `SKILL.md`.

## §6 — Config schema notes (forward compatibility)

**`work-paradigm`** is active in v1.6 (schema-version 2). The `in-development`
key has been removed for this field. `§3.1` (work-paradigm-switch) performs the
schema migration from v1 → v2 automatically on first invocation.

**`workflow-variant`** is **active** as of v1.11 (graduated in E1 — the
execution-strategy dial; no schema-version bump, mirroring the
model-effort-profile graduation). Onboarding writes `workflow-variant.value`
with **no** `in-development` key and §3.3 activates it via
`grm-workflow-variant-switch`. Preset set: `{Fast, Efficient, Cheap-Slow}`, default
`Efficient`. A legacy config carrying `in-development: true` or the retired
`Careful-Serial` value is repaired by the switch skill (drop the flag; migrate
`Careful-Serial` → `Cheap-Slow`). Absent/unset → the integration master
defaults to `Efficient`.

**`model-effort-profile`** is **active** as of v1.10 (schema-version 3, added
in v1.9 and graduated in v1.10/P1). Onboarding writes
`model-effort-profile.value` with **no** `in-development` key and §3.2
activates it via `grm-model-effort-profile-switch`. Absent/unset → the resolver
uses the registry `default-profile` (`Medium`), so old configs are
forward-compatible.

**`grm-issue-tracker`** is **active** as of v1.12 (I2/I3). The block is **optional
and additive**: onboarding writes it only when the user chooses a non-roadmap
provider (Step 6). **Absent/unset** → the abstraction synthesizes a single
`roadmap` tracker (§5.2 of `issue-tracker-design.md`) — identical to today's
behaviour, zero config changes for existing projects. Schema-version stays at 3
(no bump — same graduation precedent as `model-effort-profile` and
`workflow-variant`). §3.4 activates the block via `grm-issue-tracker-switch`
(pure-data write, no file-swap).

**`release-phase-model`** is **active** as of v1.23. The block is **additive**:
onboarding writes `release-phase-model.value` (default `Default`; `Auto` only
under Noir) and §3.5 activates it via `grm-release-phase-model-switch` (pure-data
write, no file-swap). **Absent/unset** → the integration master defaults to
`Default` (today's spawn_task pipeline) — identical to existing behaviour, zero
config changes for existing projects. Schema-version stays at 3 (no bump — same
graduation precedent as `model-effort-profile`, `workflow-variant`, and
`grm-issue-tracker`). `Auto` is Noir-only and fails closed (design
`release-phase-model-design.md` §Noir-only guard).

Forward-compat rules (for readers):
- `schema-version: 1` (or missing): `work-paradigm` is `in-development`; treat
  as advisory. Do not activate paradigm switching — the installer has not run
  yet. Map v1 aliases: `Autonomous` → `Noir`, `Collaborative` → `Weiss`.
- `schema-version: 2`: `work-paradigm.value` is active canonical;
  `model-effort-profile` absent → resolver defaults to `Medium`.
- `schema-version: 3`: `model-effort-profile.value` is active (resolver reads it
  live, no file-swap); `workflow-variant.value` is also active as of v1.11 (the
  integration master reads it live; a legacy `in-development` flag or
  `Careful-Serial` value is repaired by `grm-workflow-variant-switch`). No version
  bump rode on either graduation. `grm-issue-tracker` absent → abstraction defaults
  to a single `roadmap` tracker (no version bump, no behaviour change).

---

## §6.5 — Baseline-roadmap seeding (runs after §5, before §7)

After sentinel removal (§5) and **before** the first-release-planning bridge
(§7), seed the adopting project's `docs/roadmap.md` with the
**framework-required** baseline capabilities so they are planned by the bridge
and cannot be silently dropped during scope-trimming. Design authority:
`docs/grimoire/design/onboarding-design.md` §8.

This step **reads** the maintained, versioned source list
`.claude/skills/grm-onboarding/baseline-requirements.md` (a sibling of this file) —
do **not** hard-code the capability rows here; the source file is the single
point of maintenance.

### 6.5.1 Determine project shape

Derive the shape from the captured config and `grm-workflow-bootstrap` answers:

- **GUI** — GUI-presence answer is `yes` (§1 step 4 / §2 inference).
- **Service** — a long-running networked process (server / API / daemon),
  inferred from the project description / build commands.
- **Library** — a reusable package with no launch path of its own.
- **CLI** — a command-line program.

A project may match more than one shape (e.g. a GUI that is also a service);
seed every matching shape's rows plus the all-shapes rows.

### 6.5.2 Select and seed the rows

1. Read `baseline-requirements.md`; note its `baseline-version: N` (line 1).
2. Take **all-shapes** rows unconditionally, plus the rows whose shape
   condition matches §6.5.1.
3. Write them into `docs/roadmap.md` under a dedicated, clearly-labelled
   section, each row tagged `[framework-required]` and carrying its stable
   capability key in an HTML comment for idempotent matching:

```
## Framework-required (baseline)
<!-- seeded by onboarding from baseline-requirements.md (baseline-version: 1) -->
- Runnable test command [framework-required] <!-- key: test-command -->
- Smoke/build command [framework-required] <!-- key: smoke-build-command -->
- Non-interactive launch path [framework-required] <!-- key: non-interactive-launch -->
- Visual-inspection CLI (headless screenshot / render-to-file / DOM-or-scene dump / automation endpoint) — see UX tier (`grm-design-language-adapt`, `grm-ux-demo-build`) [framework-required] <!-- key: gui-visual-inspection-cli, shape: GUI -->
```

(The example shows the all-shapes rows plus a GUI row; seed only the rows whose
shape matches the project.)

### 6.5.3 Tagging contract

The `[framework-required]` tag is the contract that `grm-release-planning` /
`grm-release-agreement` honour: these rows may be **scheduled** into a version but
must **not** be **removed** during scope-trimming. The
`## Framework-required (baseline)` section keeps them **distinct** from the
user's own roadmap items (which live under their normal headings, untagged), so
trimming user scope can never drop a framework requirement. The HTML comment
records the `baseline-version` for idempotent re-seeds and the per-row `key:`
for additive matching.

### 6.5.4 Additive, idempotent re-seed

Seeding is **additive and idempotent**:

- A row already present (matched by its stable `key:`) is **not** duplicated on
  a re-run.
- The `baseline-version` line lets a later run (or a `grm-sync-from-upstream`
  reconciliation) add only **newly-introduced** rows when the framework bumps
  the baseline version.

### 6.5.5 GUI cross-reference to the UX tier

The GUI row does not duplicate the UX-design-language workflow — it
**cross-references** it (`grm-design-language-adapt` → `docs/design/ux/design-language.md`,
`grm-ux-demo-build` → `ux-demo/`). The visual-inspection CLI is the *agent-facing*
verification surface; the UX tier owns the *design* surface. For a GUI-deferred
project, `grm-repo-init` already adds a `## Backlog` UX row; this baseline row
complements it without colliding.

### 6.5.6 Ordering (F3 seeds, then F1 plans)

This seeding step runs **before** the §7 bridge so the framework-required rows
are present when the bridge's `grm-release-planning` proposes the first plan — the
load-bearing F3-then-F1 runtime order from
`docs/grimoire/design/onboarding-design.md` §8.7. The bridge then plans *from* the
seeded roadmap; if seeding is skipped or the roadmap is unseeded, the bridge
still proceeds gracefully (§7.4).

### 6.5.7 Web-app catalog filing (conditional — web-app projects only)

**Only when `web-app.value` is `"yes"` in the written config.** After the
baseline-roadmap rows are seeded (§6.5.2), trigger the required-feature
catalog filing hand-off:

1. Read `.claude/skills/grm-web-app-apply/required-feature-catalog.md` for the
   entry list and `catalog-version`.
2. Deduplicate: list all `Grimoire-Requirement`-tagged issues (open **and**
   closed) and skip any entry whose `[key: <key>]` marker is already present
   in an existing issue title.
3. For each unfiled entry, spawn a **Reporter** (`grm-reporter` skill) to file
   one `Grimoire-Requirement`-tagged ticket via `grm-feedback-to-issue`, using
   the title, body, labels, and `audience: "internal"` from the catalog entry.
   `ensure_label` is called automatically before filing (WEB-5).

This is idempotent: a re-run of onboarding files nothing if every entry is
already filed. If the project's issue tracker is not yet configured (roadmap
default), the Reporter files into the roadmap backend — no special case needed.

Design authority: `docs/design/web-app-support-design.md` §5.2 (filing flow).
Catalog source: `.claude/skills/grm-web-app-apply/required-feature-catalog.md`.

**Non-web projects:** skip §6.5.7 entirely.

---

## Anti-patterns

- Running `git init` silently on the interactive path — the §0.2 confirmation
  is mandatory; only `SKIP ONBOARDING` carries implied consent, and even then
  the action must be announced.
- Re-running `git init` or making a second initial commit when a repo already
  exists — §0 is skipped wholesale in the idempotent case (§0.4).
- Creating `dev` / `version/*` during §0 — onboarding produces only "a repo on
  `main` with one commit"; `grm-repo-init` (§4) owns the branch model.
- Defaulting the project name to "Grimoire" — that is the scaffolding's name,
  not the adopting project's.
- Batching unrelated interview questions in a single `AskUserQuestion`.
- Calling `grm-repo-init` when `main` + `dev` already exist — check first.
- Running sentinel removal before `grm-workflow-bootstrap` completes — removal is
  always the final step.
- Using `sed -i '1d'` blindly — confirm line 1 matches before deleting.
- Writing `workflow-variant` with an `in-development` flag, or treating the
  execution strategy as preview/not-yet-active — the field graduated in v1.11
  (E1); it is active and carries only `value`, and §3.3 activates it via
  `grm-workflow-variant-switch`.
- Persisting `Careful-Serial` in `workflow-variant.value` — it is migrated to
  `Cheap-Slow` (the project preset set is `{Fast, Efficient, Cheap-Slow}`).
- Writing `work-paradigm.in-development` at all in a v2 config — this key does
  not exist in schema-version 2; the switch skill removes it during migration.
- Writing `model-effort-profile` with an `in-development` flag — the field
  graduated in v1.10 (P1); it is active and carries only `value`.
- Treating the model/effort profile as a preview/not-yet-active field — it is a
  real, active choice; §3.2 activates it via `grm-model-effort-profile-switch`.
- Deriving one dial's value from another (e.g. silently forcing `Autonomous`
  under Noir, or setting the execution strategy from the paradigm) — the three
  dials (work-paradigm × execution-strategy × model-effort-profile) are
  **independent**; none auto-derives another. At most a one-line non-binding
  hint is allowed (`execution-profiles-design.md` §A/§F.2).
- Skipping §3.2 or §3.3 activation, or running them before §3 writes the config
  — the switch skills read the written `value` (or their argument) and must run
  after the config exists.
- Auto-running the first-release-planning bridge under Supervised or Weiss —
  those paradigms **prompt-offer** (§7.1); only Noir auto-kicks-off.
- Prompt-offering the bridge under `SKIP ONBOARDING` for Supervised/Weiss —
  there is no interactive session; it is a no-op with a pointer (§7.2). Only
  Noir auto-runs under SKIP.
- Hard-coding the baseline capability rows in this skill — §6.5 always reads
  them from `baseline-requirements.md` (the single point of maintenance).
- Seeding baseline rows under the user's own roadmap headings, or omitting the
  `[framework-required]` tag — they must live under the dedicated
  `## Framework-required (baseline)` section so scope-trimming cannot drop them
  (§6.5.3).
- Duplicating an already-seeded baseline row on re-run — seeding matches by the
  stable `key:` and is additive/idempotent (§6.5.4).
- Running the §6.5 seeding step after the §7 bridge — seeding must run first so
  the bridge plans from a populated roadmap (§6.5.6 / §8.7).
- Re-implementing planning logic in the bridge — it calls `grm-release-planning` /
  `grm-release-agreement` / `grm-integration-master` as-is (§7).
- Blocking onboarding completion when the roadmap is unseeded — the bridge
  tolerates a missing/unseeded roadmap gracefully (§7.4).
- Running the bridge before sentinel removal or before roadmap seeding — the
  bridge is always the final phase.
- Writing an `grm-issue-tracker` block when the user chose `roadmap` (the default) —
  absence is the forward-compat default; writing an explicit `roadmap` block is
  harmless but unnecessary noise. Omit it.
- Calling `grm-issue-tracker-switch` when the roadmap default was selected — §3.4 is
  skipped entirely in the roadmap case; do not call the skill.
- Calling `grm-issue-tracker-switch` before §3 writes the config — the switch skill
  reads and writes the config file; it must run after §3.
- Accepting a `github` provider without a `repo` value — provider `github`
  requires a non-null `owner/repo` string; if the user left it blank, either
  re-prompt or defer to a later `grm-issue-tracker-switch` call.
- Bumping `schema-version` when writing the `grm-issue-tracker` block — the block is
  additive at schema-version 3; no version bump (mirrors the `model-effort-profile`
  and `workflow-variant` graduation precedent).
- Deriving the issue-tracker choice from any other dial (paradigm, execution
  strategy, model/effort profile) — the `grm-issue-tracker` block is a fourth
  independent config entry; it is orthogonal to all three dials.
- Offering `Auto` for the release-phase model under a non-Noir paradigm, or
  writing `release-phase-model.value: "Auto"` outside Noir — `Auto` is Noir-only
  and fails closed (§Step 7 / §3.5); under Supervised/Weiss the dial is fixed at
  `Default`.
- Bumping `schema-version` when writing the `release-phase-model` block — the
  block is additive at schema-version 3 (same precedent as `model-effort-profile`,
  `workflow-variant`, and `grm-issue-tracker`).
- Skipping §3.5 activation, or running it before §3 writes the config — the
  switch skill reads the written `value` (or its argument) and must run after
  the config exists.
- Running the §6.5.7 catalog filing step for a non-web project — it is
  conditional; skip it entirely when `web-app.value` is not `"yes"`.
- Filing catalog entries without deduplicating against existing tagged issues
  first — always check `Grimoire-Requirement`-tagged issues (open and closed)
  before filing, so re-runs are no-ops (§6.5.7).

## Default label taxonomy seeding (v1.31, #69)

At Step 6, **for a GitHub tracker only**, offer to seed the recommended
label/audience taxonomy (`docs/grimoire/design/issue-label-taxonomy.md`): type × area ×
priority labels + the `audience` routing. Idempotent — create each label if
absent, never delete/recolor an existing one. **No-op for the `roadmap`
provider.** Seed through the issue-tracker abstraction's `label` operation, not
raw `gh`, so routing + caching are honored.
### 7.1 Paradigm-conditional behaviour

Branch on `work-paradigm.value` (active canonical at schema-version 2):

| Paradigm | Bridge behaviour |
|----------|------------------|
| **Noir** (Autonomous) | **Auto-kick-off.** As integration master, propose an initial roadmap direction, run `grm-release-planning`, lock a first plan via `grm-release-agreement`, and cut `version/{X.Y}` — all **before any building**, without per-step user confirmation. Surface the locked plan to the user as a milestone for review. |
| **Supervised** (default) | **Prompt-offer.** Ask once via `AskUserQuestion`: "Setup is complete. Would you like me to draft and lock a first release plan now, or stop here?" Only on an affirmative answer run the same `grm-release-planning` → `grm-release-agreement` → cut-`version/{X.Y}` sequence, each step still surfacing its normal Supervised confirmation. |
| **Weiss** (Collaborative) | **Prompt-offer**, same as Supervised, but framed as user-led: offer to *assist* with first-release planning; the user drives the roadmap and scope decisions. |

The version label for the first plan (`v0.1` vs `v1.0`) is a planning decision:
Noir picks a sensible default (recommend `v0.1` for a greenfield project with no
shipped surface) and notes it in the proposed plan; the prompt-offer paradigms
surface the choice to the user.

### 7.2 `SKIP ONBOARDING` interaction

`SKIP ONBOARDING` (§2) is a non-interactive path; the bridge respects the
inferred paradigm:

- **Noir inferred** → the bridge **auto-runs** exactly as in §7.1 (the whole
  point of the non-interactive path is full hands-off setup *including* the
  first-plan lock).
- **Supervised or Weiss inferred** → the bridge is a **no-op** (there is no
  interactive session to prompt-offer into). Stop after the roadmap is seeded
  and print a one-line pointer:
  > "Run `grm-release-planning` when you're ready to scope your first release."

### 7.3 Where it hooks in the sequence

The bridge runs after the baseline-roadmap seeding step (§6.5). If seeding was
skipped or the roadmap carries no `[framework-required]` rows, the bridge still
runs as the final phase and handles the unseeded roadmap per §7.4.

### 7.4 Tolerating an unseeded roadmap

If `docs/roadmap.md` is missing or carries no `[framework-required]` baseline
rows (e.g. F3 has not yet seeded it), the bridge does **not** fail:

- **Noir** — proceed with `grm-release-planning` from whatever roadmap content
  exists (or an empty roadmap), proposing the integration master's initial
  direction; note in the proposed plan that the framework-required baseline was
  not present.
- **Supervised / Weiss** — the prompt-offer still applies; if the user declines,
  stop normally. If they accept, run `grm-release-planning` against the available
  roadmap.

The bridge never blocks onboarding completion on the roadmap being seeded.

---

