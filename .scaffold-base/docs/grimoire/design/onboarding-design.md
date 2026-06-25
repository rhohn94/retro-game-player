# Onboarding & Project-Config Design

> **Up:** [↑ Design docs](README.md)


## Motivation

A freshly copied Grimoire scaffold is inert until the user runs
`grm-repo-init` / `grm-workflow-bootstrap`. Without a reliable trigger the user
may skip initialization entirely, leaving placeholders unfilled and
interview config absent. v1.5 closes that gap: a removable sentinel fires
on the user's *first* prompt, routing them into initialization, and an
interview captures durable project preferences — including two
in-development preference fields (`work-paradigm`, `workflow-variant`)
whose slots must exist from day one so future features read them without
re-interviewing.

The project-name decision is already made: **Grimoire**. The config file
is **`.claude/grimoire-config.json`**.

---

## Scope

**Covers:**
- First-run onboarding interview: prompt flow and order, hand-off to
  `grm-repo-init` / `grm-workflow-bootstrap`.
- Project-config surface: `.claude/grimoire-config.json` versioned schema
  with field types, enums, and `in-development` semantics.
- Sentinel-trigger lifecycle: location recommendation, detection, and
  idempotent removal.
- `SKIP ONBOARDING` escape hatch: detection, inference rules, defaults,
  non-interactive bootstrap, sentinel removal.
- Decision: interview as a new skill vs. a `grm-repo-init` extension (shapes A3).
- **(v1.8 extension)** Three onboarding-lifecycle flows that Phase-2 items
  implement: the onboarding → first-release-planning bridge (§6 / F1), the
  git-repo-init prerequisite (§7 / F4), and framework-required baseline
  roadmap seeding (§8 / F3). §6–§8 are contracts for F1/F4/F3; no code lands
  with this doc.

**Does not cover:**
- Implementing Work Paradigm switching (`Supervised` / `Autonomous` /
  `Collaborative`) — that is a future release. v1.5 captures the
  preference only.
- Implementing the three Workflow variants — capture-only *in v1.5*. (Note:
  the dial later graduated to the active **execution-strategy** dial in v1.11
  with the preset set `{Fast, Efficient, Cheap-Slow}`; see
  [execution-profiles-design.md](execution-profiles-design.md) and §1.2 Step 3 above.)
- The A2 sentinel file/line itself (A2 creates the artifact; this doc
  defines the contract A2 must satisfy).
- The A3 implementation (this doc is its contract).

---

## Design

### 1. First-run onboarding interview

#### 1.1 Trigger

The sentinel (defined in A2) is checked at the top of every prompt handler
before any other logic. When the sentinel is present, the onboarding flow
takes over regardless of what the user typed — unless the first prompt
contains the literal text `SKIP ONBOARDING` (see §4).

After the sentinel fires, the interview proceeds in the order below. The
sentinel is removed **at the end of the interview**, after
`grm-workflow-bootstrap` completes, as its last idempotent step (§3).

#### 1.2 Interview prompt order

All questions use `AskUserQuestion`. Questions are presented sequentially;
do not batch unrelated questions. Offer a default for every question where
one exists; the user can accept with a single keypress.

| Step | Question | Notes |
|------|----------|-------|
| 1 | **Project name** — "What is the name of your project?" | Default: directory name; no fallback to `Grimoire` (that is the scaffolding's name, not the adopter's project). |
| 2 | **Work paradigm** *(preview)* — "Choose your Work Paradigm (preview — not yet active): Supervised / Autonomous / Collaborative." | Default: `Supervised`. Show preview label prominently. Explain one-liner: Supervised = user-confirms; Autonomous = agent-led; Collaborative = user-led design. |
| 3 | **Execution strategy** *(active, v1.11)* — "Choose your execution strategy (how work is dispatched — independent of paradigm and profile): Fast / Efficient / Cheap-Slow." | **Active choice** (`workflow-variant` graduated in v1.11/E1 — the execution-strategy dial). Default: `Efficient`. Frame via the speed/quality/cost triangle: Fast = speed (max parallel fan-out); Efficient = balanced; Cheap-Slow = cost (low fan-out + small batches, pairs with a cheap profile). Accept legacy `Careful-Serial` → migrated to `Cheap-Slow`. Written active (no `in-development`) and activated via `grm-workflow-variant-switch`. **Independent dial** — never derived from Step 2 or Step 5. |
| 4 | **GUI presence** — "Does this project have (or will have) a user interface? Yes / Not yet / No (headless)." | Feeds `grm-workflow-bootstrap` step 3 question 9; pass the answer through to avoid re-asking. |
| 5 | **Model/effort profile** *(active)* — "Choose your cost posture: Medium / High Effort / Efficient / Low Effort / Eco/Budget / Autonomous." | **Active choice** (`model-effort-profile` graduated in v1.10/P1). Default **`Medium`** for every paradigm — the dial is **independent**, never derived from the paradigm (Step 2) or execution strategy (Step 3). At most a one-line non-binding hint (e.g. "Noir teams often pick Autonomous + Cheap-Slow, but any combination is valid"). Written active (no `in-development`) and activated via `grm-model-effort-profile-switch`. |
| 6 | **Issue tracker** *(active, v1.12)* — "Choose your issue tracker: Roadmap (default) — issues live in `docs/roadmap.md` `## Backlog`; or GitHub — issues live in a GitHub Issues repo." | **Active choice** (`grm-issue-tracker` block added in v1.12/I2). Default: `roadmap` (zero network, no config written — absence is the forward-compat default). If `github`: ask for `owner/repo`; optionally a second external repo for a two-tracker setup. Written as the `grm-issue-tracker` block in config; activated via §3.4 (`grm-issue-tracker-switch`, pure-data write — no file-swap). **Independent** — never derived from any other dial. If roadmap default selected: block is omitted from config. Full interview flow: `issue-tracker-design.md §9`. |

Step 2 must clearly state that the selected value is **"preview — not yet
active"** for the *capture-only* sense it historically had; in current reality
(v1.6+) the paradigm activates immediately via `grm-work-paradigm-switch`. Steps 3
and 5 are both **active** choices that take effect immediately: the integration
master reads `workflow-variant.value` live at dispatch (Step 3), and the
resolver reads `model-effort-profile.value` live at every work-item dispatch
(Step 5). Step 6 is an **active** choice whose config write is the activation
(the abstraction reads the block live; no file-swap needed).

**The three dials are orthogonal and independently selectable (v1.11 / E3).**
work-paradigm (Step 2, *who drives*) × execution-strategy (Step 3, *how work is
dispatched*) × model-effort-profile (Step 5, *which model tier*) compose freely
— **no dial auto-derives another**. The v1.10 onboarding behaviour that
recommended/auto-selected the `Autonomous` profile *because* the paradigm was
Noir is softened (E3) to a **non-binding one-line hint**; the highlighted
default for every paradigm is `Medium`, and the user freely picks any profile.
This makes the §A orthogonality contract of [execution-profiles-design.md](execution-profiles-design.md)
operational at the onboarding seam: no onboarding step writes one dial's value
as a function of another's. The full triangle/matrix lives in
[execution-profiles-design.md](execution-profiles-design.md) (§A/§B/§F). The `grm-issue-tracker` block (Step 6)
is orthogonal to all three dials: any combination is valid (see §2.5).

#### 1.3 Hand-off sequence

After collecting answers from steps 1–5:

1. Write `.claude/grimoire-config.json` (§2).
2. Activate the selected paradigm via `grm-work-paradigm-switch`.
3. Activate the selected model/effort profile via
   `grm-model-effort-profile-switch` (pure-data write; no file-swap).
4. Activate the selected execution strategy via `grm-workflow-variant-switch`
   (pure-data write; no file-swap — same shape as step 3).
4a. Activate the issue tracker via `grm-issue-tracker-switch` (pure-data
   config write; no file-swap — only if a non-roadmap provider was
   selected in Step 6; skip entirely if roadmap default). See §3.4 in
   `issue-tracker-design.md §9.4`.
5. Call `grm-repo-init` to stand up the branch model and guards (if not
   already initialized — detect via `git branch` output; skip if
   `main` + `dev` already exist).
6. Call `grm-workflow-bootstrap`. Pass the GUI-presence answer (step 4) so
   `grm-workflow-bootstrap` skips its own GUI question and uses the captured
   answer.
7. Remove the sentinel (§3, idempotent).
8. Confirm completion to the user: "Onboarding complete. Your project
   config is at `.claude/grimoire-config.json`."

---

### 2. Project-config surface: `.claude/grimoire-config.json`

#### 2.1 Purpose

A persistent, forward-compatible store for project-level preferences that
skills and future features read. Written once at onboarding (or during
`SKIP ONBOARDING`); never re-written by the interview unless the user
explicitly re-runs onboarding.

#### 2.2 Versioned schema

The top-level `schema-version` field lets future features detect which
version of the schema they are reading and apply migrations without
re-interviewing the user.

**Current schema version: `1`.**

```json
{
  "schema-version": 1,
  "name": "string",
  "work-paradigm": {
    "value": "Supervised | Autonomous | Collaborative",
    "in-development": true
  },
  "workflow-variant": {
    "value": "Efficient | Fast | Careful-Serial",
    "in-development": true
  }
}
```

#### 2.3 Field reference

| Field | Type | Allowed values | Required | Notes |
|-------|------|----------------|----------|-------|
| `schema-version` | integer | `1` | yes | Increment when the schema changes in a breaking way. |
| `name` | string | any non-empty string | yes | The project's chosen product name, captured at onboarding step 1. |
| `work-paradigm.value` | string enum | `Supervised`, `Autonomous`, `Collaborative` | yes | The chosen work paradigm. |
| `work-paradigm.in-development` | boolean | `true` | yes | Must be `true` for schema-version 1. Signals the feature is not yet active. |
| `workflow-variant.value` | string enum | `Efficient`, `Fast`, `Careful-Serial` | yes | The chosen workflow variant. |
| `workflow-variant.in-development` | boolean | `true` | yes | Must be `true` for schema-version 1. Signals the feature is not yet active. |

> **Schema evolution since this baseline.** The table above is the v1 onboarding
> baseline. The live schema has since advanced — see [work-paradigm-design.md](work-paradigm-design.md) §5
> for the version-of-record progression: **v1→2** activated `work-paradigm`
> (dropped its `in-development`); **v2→3** added the optional, additive
> `model-effort-profile` object, value one of
> `Medium | High Effort | Low Effort | Efficient | Autonomous | Eco/Budget`,
> default/absent → `Medium`. It shipped previewed in v1.9 (`{ value,
> in-development }`) and **graduated to active in v1.10 (P1)** by dropping the
> `in-development` flag — onboarding now writes it as a real, active choice
> (`{ value }`) and activates it via `grm-model-effort-profile-switch` (§1.3 step 3;
> the `Autonomous` profile is the recommended default under Noir). Both later
> bumps preserve forward-compat: an older config is read identically to one with
> the field at its default.

#### 2.4 `in-development` semantics

`in-development: true` means:

- **Persisted but inert.** The value is written to disk and preserved
  across updates, but no current Grimoire code reads it to alter behaviour.
- **Surfaced as "preview — not yet active"** during the interview and in
  any UI that displays the config.
- **Read unchanged by future features.** When Work Paradigm or Workflow
  Variant features land in a future release, they read
  `work-paradigm.value` / `workflow-variant.value` directly — no
  re-interview, no migration step. The `in-development` key will be
  removed (or set to `false`) by that future feature's bootstrap step,
  triggering a `schema-version` bump.
- **Forward-compat guarantee.** Any reader that sees `in-development: true`
  must treat the field as advisory and must not fail if the value is
  outside its expected set (defensive read). This allows schema-version 1
  configs to survive future schema additions without re-onboarding.

#### 2.5 `grm-issue-tracker` config block (v1.12 / I2)

The `grm-issue-tracker` block is a **fourth independent config entry**, added as a
peer of the three existing dials. It is **optional** — absence is the
forward-compat default (a single `roadmap` tracker synthesized by the
abstraction; zero behavioural change for existing projects). Schema-version
stays at **3** (no bump, following the v1.10/v1.11 graduation precedent).

**Block shape:**

```json
"issue-tracker": {
  "trackers": [
    {
      "name": "default",
      "provider": "roadmap",
      "repo": null,
      "audience": "internal",
      "labels": []
    }
  ],
  "default-for-filing": "default"
}
```

**`trackers` list** — each entry is a named tracker:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | `string` | yes | Unique within this project; used in routing and CLI. |
| `provider` | `"roadmap" \| "github" \| "grimoire"` | yes | Backend selector; `grimoire` is reserved (no implementation in v1.12). |
| `repo` | `string \| null` | github: yes; others: null | `"owner/repo"` format for GitHub Issues; null for roadmap backend. |
| `audience` | `"internal" \| "external"` | yes | Default audience for issues filed here; drives create routing. |
| `labels` | `string[]` | no | Labels auto-applied to every issue filed to this tracker. |

**`default-for-filing`** — the tracker `name` used when create routing finds
no explicit match. Must refer to a name in `trackers`.

**Absent block (synthesized roadmap default):** when the config has no
`grm-issue-tracker` key, the abstraction synthesizes a single `roadmap` tracker
named `"default"` — identical to the explicit default. Old configs and roadmap-
only projects need zero changes.

**Multi-tracker / separate-issues-repo topology:** a project may configure N
named trackers, each with its own `provider`, `repo`, and `audience`. Common
topologies are same-repo (source and issues share the same GitHub repo),
separate-issues-repo (dedicated issues repo for public visibility without
exposing source), and multiple-issues-repos (separate internal and external
trackers routed by audience). For the GitHub visibility constraint and
cross-repo cost implications, see `docs/design/issue-tracker-design.md §6`.

**Onboarding capture:** Step 6 of the interview captures the tracker choice
(§1.2 below); §3.4 activates it (pure-data config write — no file-swap).
If the user selects the `roadmap` default, the block is omitted from the config
entirely (absence is the forward-compat default). If the user selects `github`,
the block is written with the captured `repo`. A two-tracker setup (internal +
external) writes two entries; see `issue-tracker-design.md §9` for the full
onboarding capture flow.

#### 2.6 `framework-version` marker (v1.13 / F1)

`framework-version` is an **optional, additive top-level field** (peer of the
existing dials) that records the highest Grimoire release whose feature
adoptions are complete on this project. Schema-version stays at **3** (additive
at schema-version 3, following the v1.10/v1.11/v1.12 precedent; readers that
do not understand the field simply ignore it).

```json
"framework-version": "v1.12"
```

**Semantics:** `"v1.12"` means all features introduced through v1.12 have been
adopted (or were detected-as-already-adopted) on this project. The field
advances to the upstream's current version after the sync adoption phase
(§4.5 of [feature-aware-sync-design.md](feature-aware-sync-design.md)) completes without failures.

**Absent field:** when `framework-version` is absent (any project created
before v1.13 F1), the sync adoption phase falls back to per-feature `detect`
evaluation against every manifest entry. This gives old projects a graceful
first-run experience without requiring them to know which release introduced
each feature.

**Writer:** the sync adoption phase is the **only** code path that writes or
advances this field. Onboarding does not write it (the marker is set after
the first successful adoption phase, not at project creation time). See
`docs/design/feature-aware-sync-design.md §3` for full semantics.

#### 2.7 Why `work-paradigm` is captured now

The roadmap records a key direction: in the future **Noir (Autonomous)**
paradigm, the read-only-workflow convention is **lifted** — write-capable
workflows may perform implementation directly via per-agent worktree
isolation. Capturing `work-paradigm` at onboarding means the preference
store and prompt slots exist before that feature lands, avoiding a retrofit
re-interview. The Weiss (Collaborative) and Supervised paradigms preserve
the read-only convention.

#### 2.7 Example config file

A config for a project named "Acme Widget" that chose Autonomous + Fast:

```json
{
  "schema-version": 1,
  "name": "Acme Widget",
  "work-paradigm": {
    "value": "Autonomous",
    "in-development": true
  },
  "workflow-variant": {
    "value": "Fast",
    "in-development": true
  }
}
```

A minimal config with defaults (Supervised + Efficient):

```json
{
  "schema-version": 1,
  "name": "My Project",
  "work-paradigm": {
    "value": "Supervised",
    "in-development": true
  },
  "workflow-variant": {
    "value": "Efficient",
    "in-development": true
  }
}
```

---

### 3. Sentinel-trigger lifecycle

#### 3.1 Location recommendation and justification

**Recommended location: top-of-`CLAUDE.md` line.**

Specifically, the sentinel is a single line inserted as the very first
line of `CLAUDE.md`:

```
<!-- GRIMOIRE_ONBOARDING_SENTINEL -->
```

**Rationale vs. a `.claude/` flag file:**

| Factor | Top-of-CLAUDE.md line | `.claude/` flag file |
|--------|-----------------------|----------------------|
| Visibility | Immediately visible in the most-read file; hard to miss | Hidden in `.claude/`; easy to miss |
| Detection reliability | `CLAUDE.md` is always loaded first; detection is guaranteed | Requires an explicit file-existence check instruction |
| Removal simplicity | One-line delete; trivially idempotent | File delete; also idempotent but one extra filesystem call |
| Accidental persistence | Extremely unlikely — a human opening `CLAUDE.md` sees it | Could linger unnoticed in `.claude/` |
| Impact on `CLAUDE.md` readability | Minimal — top comment, removed after first run | None |
| Works without hook infra | Yes — `CLAUDE.md` content is read before any hook runs | Depends on a `PreToolUse` check or similar |

The flag-file approach would require hooking into the prompt-pre-processing
pipeline (a `PreToolUse` hook or equivalent), which is more fragile than
relying on the agent reading `CLAUDE.md` — which the harness guarantees on
every session. A top-of-file comment line is simpler, more visible, and
works without additional infrastructure.

#### 3.2 Sentinel line

```
<!-- GRIMOIRE_ONBOARDING_SENTINEL -->
```

This line must be the **first line** of `CLAUDE.md` in the freshly
distributed scaffold. Its position (line 1) is significant: agents and
detection logic search only line 1, not the whole file, so false positives
after removal are structurally impossible.

#### 3.3 Detection logic (instruction to include in CLAUDE.md after removal)

Before the sentinel is removed, `CLAUDE.md` line 1 reads the sentinel
comment. The agent instruction is:

> "If line 1 of this file is `<!-- GRIMOIRE_ONBOARDING_SENTINEL -->`,
> run the Grimoire onboarding flow before handling any other part of
> this prompt."

This instruction lives in `CLAUDE.md` itself (inserted by A2 as a
permanent instruction) so it survives after the sentinel line is removed.

#### 3.4 Routing

When the sentinel is detected, the agent must:

1. Check whether the first prompt contains the literal text
   `SKIP ONBOARDING` (case-sensitive). If yes → go to §4.
2. Otherwise → begin the interactive interview (§1.2).

The rest of the user's prompt (the non-sentinel portion) is deferred until
onboarding completes; the agent should acknowledge this to the user:
"I see this is a fresh Grimoire project. Let me walk you through setup
first."

#### 3.5 Removal

The sentinel line is removed as the **final step** of onboarding (both
interactive and SKIP paths), after `grm-workflow-bootstrap` completes:

```bash
# Remove line 1 if and only if it is the sentinel
# (idempotent: no error if already removed)
```

Implementation note for A2/A3: use an in-place edit that removes exactly
line 1 when it matches the sentinel literal. Do not use `sed -i '1d'`
blindly — confirm line 1 matches before deletion to ensure idempotency
and safety. If line 1 does not match the sentinel, removal is a no-op
(already removed; do not error).

After removal, `CLAUDE.md` must not contain the sentinel anywhere. The
detection instruction (§3.3) remains — it is harmless when the sentinel
is absent.

---

### 4. `SKIP ONBOARDING` escape hatch

#### 4.1 Purpose

Lets a project that already knows its settings (or wants sensible
defaults) skip the interactive interview entirely. Useful for small
projects, CI bootstrapping, or automated setup.

#### 4.2 Detection

- **Case-sensitive** literal string match: the first prompt must contain
  exactly `SKIP ONBOARDING` (uppercase, with a single space, no
  surrounding punctuation required).
- Detection is performed **after** the sentinel check fires (§3.4 step 1).
- Only the first prompt is checked; subsequent prompts are never treated
  as onboarding prompts.

#### 4.3 Inference rules

When `SKIP ONBOARDING` is detected, the agent reads the rest of the
first prompt and applies these inference rules in order:

| Field | Inference rule | Default if not inferable |
|-------|----------------|--------------------------|
| `name` | Take any quoted string after `name:` or `project:` in the prompt (e.g. `name: "Acme"`, `project: Acme`). If none, use the repository directory name (basename of `git rev-parse --show-toplevel`). If that is also ambiguous, use `"My Project"`. | `"My Project"` |
| `work-paradigm.value` | Look for one of `Supervised`, `Autonomous`, `Collaborative` (case-insensitive) anywhere in the prompt. Take the first match. | `"Supervised"` |
| `workflow-variant.value` | Look for one of `Fast`, `Efficient`, `Cheap-Slow` (case-insensitive; also legacy `Careful-Serial` → migrated to `Cheap-Slow`) anywhere in the prompt. Take the first match. Independent of paradigm — never derived from it. Written active (no `in-development`). | `"Efficient"` |
| `model-effort-profile.value` | Look for one of `Medium`, `High Effort`, `Low Effort`, `Efficient`, `Autonomous`, `Eco/Budget` (case-insensitive; `noir` → `Autonomous`). If none matched → `Medium`. Independent of paradigm — never derived from it. Written active (no `in-development`). | `"Medium"` |
| `work-paradigm.in-development` | Written `true` here (pre-activation), then dropped by `grm-work-paradigm-switch`. | `true` |
| GUI presence | Look for `GUI`, `ui`, `interface`, `web`, `app`, `frontend` (case-insensitive) in the prompt → `yes`. Look for `headless`, `CLI`, `api` → `no`. Otherwise → `not yet`. | `"not yet"` |
| `grm-issue-tracker` block | Look for `github` (case-insensitive) in the prompt → write the block with `provider: "github"` and capture `owner/repo` adjacent to the `github` keyword. Look for `internal` + `external` both present → dual-tracker config. If only `roadmap` or no tracker keyword: **omit the block** entirely (absence is the forward-compat default). Full inference rules: `issue-tracker-design.md §9.2`. | block absent (roadmap default) |

#### 4.4 Non-interactive bootstrap sequence

1. Apply inference rules to produce a config object.
2. Write `.claude/grimoire-config.json` (§2).
3. Activate the inferred paradigm (`grm-work-paradigm-switch`), the inferred
   model/effort profile (`grm-model-effort-profile-switch`, default `Medium`), the
   inferred execution strategy (`grm-workflow-variant-switch`, default `Efficient`),
   and — if a non-roadmap tracker was inferred — the issue tracker
   (`grm-issue-tracker-switch`) — four independent activations, none derived from
   another. If roadmap default: skip `grm-issue-tracker-switch` (absence is the
   forward-compat default).
4. Call `grm-repo-init` (skip if already initialized — same check as §1.3
   step 2).
5. Call `grm-workflow-bootstrap` in non-interactive mode: pass the inferred
   GUI-presence answer and suppress `AskUserQuestion` calls for fields
   already covered by grimoire-config.json. Remaining `grm-workflow-bootstrap`
   interview questions (test/build/release commands, doc-location map,
   etc.) still require answers; prompt for only those.
6. Remove the sentinel (idempotent — §3.5).
7. Confirm to the user: "SKIP ONBOARDING detected. Config written with
   inferred values — review `.claude/grimoire-config.json` and adjust if
   needed."

#### 4.5 Sentinel removal

The sentinel is removed exactly as in the interactive path (§3.5) — the
same idempotent deletion, as the final step. `SKIP ONBOARDING` receives
no special-case removal logic.

---

### 5. Decision: interview as a new skill or a `grm-repo-init` extension

**Decision: implement the onboarding interview as a NEW skill.**

Name: `grm-onboarding` (or `grimoire-init` — to be confirmed by A3's author).

**Rationale:**

1. **Single-responsibility.** `grm-repo-init` initializes the git branch model
   and guards. Adding interview logic and config-file authoring to it
   conflates two concerns: version-control setup vs. project-preference
   capture. These are separable and will evolve independently.

2. **Invocation surface.** The sentinel trigger must call a discrete,
   nameable unit. A new skill gives A2 a clean, stable call target
   (`grm-onboarding` skill) without coupling the sentinel to `grm-repo-init`'s
   internals.

3. **`grm-repo-init` composability.** The new skill calls `grm-repo-init` as a
   sub-step (§1.3 step 2). This preserves `grm-repo-init`'s standalone use for
   projects that skip onboarding or re-run git setup independently.

4. **Future extensibility.** If the interview grows (e.g. additional
   paradigm questions in a future release), the new skill absorbs changes
   without touching `grm-repo-init`.

5. **`grm-workflow-bootstrap` composability.** The new skill calls
   `grm-workflow-bootstrap` as a sub-step (§1.3 step 3), passing the captured
   GUI-presence answer. This avoids duplication: `grm-workflow-bootstrap`
   retains its own standalone use, and the grm-onboarding skill orchestrates
   both.

**Shapes A3:** A3 must create a new `grm-onboarding` skill (not extend
`grm-repo-init`) and wire it as the sentinel's call target.

---

## v1.8 onboarding-lifecycle extension

The original design (§1–§5) ends onboarding at "sentinel removed; project
initialized". v1.8 adds three flows that extend the lifecycle on either side
of that endpoint. They share one execution order at runtime, which the
implementation items must honour:

```
git-repo-init prerequisite (§7 / F4)          ← BEFORE repo-init
  → write config → activate paradigm
  → repo-init → workflow-bootstrap → remove sentinel   (existing §1.3 / §4 / §5)
  → baseline-roadmap seeding (§8 / F3)        ← seeds roadmap.md
  → first-release-planning bridge (§6 / F1)   ← plans FROM the seeded roadmap
```

The ordering is load-bearing: **F4 runs first** (you cannot run `grm-repo-init`'s
branch model without a repo); **F3 seeds the roadmap** that **F1 then plans
from**. F1 must not propose a first release before F3 has populated the
framework-required baseline, or the first plan will omit the capabilities
that make the project self-verifiable. This matches the release-planning
order recorded in `docs/grimoire/release-planning-v1.8.md` §4 Track A (F4 → F1 → F3);
note that F1 and F3 land in that branch order for merge-conflict reasons, but
their *runtime* order inside the grm-onboarding skill is F3-then-F1 as shown
above. The implementation must place the F3 seeding step before the F1 bridge
step in the skill body regardless of merge order.

---

### 6. Onboarding → first-release-planning bridge (F1)

#### 6.1 Purpose

A freshly onboarded project today stops at "initialized" and then waits for
the user to start a release by hand. This is a gap, especially under **Noir**
(Autonomous), where the integration master is expected to lead planning and
integration without per-step user prompts. The bridge closes the gap: after
the project is initialized and the roadmap is seeded (§8), onboarding flows
directly into *first-release planning* rather than idling.

#### 6.2 Where it hooks into the flow

The bridge is a **new final phase of the `grm-onboarding` skill**, appended after
the existing steps. The full onboarding sequence becomes:

1. Git-repo-init prerequisite (§7).
2. Write `.claude/grimoire-config.json` (§3).
3. Activate the selected paradigm — `grm-work-paradigm-switch` (§3.1).
4. Activate the selected model/effort profile — `grm-model-effort-profile-switch`
   (§3.2; default `Medium`, independent of paradigm).
5. Activate the selected execution strategy — `grm-workflow-variant-switch` (§3.3;
   default `Efficient`, independent of paradigm and profile).
6. `grm-repo-init` → `grm-workflow-bootstrap` (§4).
7. Remove the sentinel (§5).
8. **Baseline-roadmap seeding (§8 / F3).**
9. **First-release-planning bridge (this section / F1).**

The bridge is the *last* onboarding step, so the project is fully initialized
(branch model, guards, paradigm content, seeded roadmap) before any planning
begins. It reuses the existing release skills rather than re-implementing
planning: `grm-release-planning` (propose work items from the roadmap),
`grm-release-agreement` (lock the plan, write `docs/release-planning-v{X.Y}.md`,
cut `version/{X.Y}`). The integration master role described in
`.claude/skills/grm-integration-master/SKILL.md` owns this phase.

#### 6.3 Paradigm-conditional behaviour

The bridge branches on `work-paradigm.value` (now active canonical at
schema-version 2):

| Paradigm | Bridge behaviour |
|----------|------------------|
| **Noir** (Autonomous) | **Auto-kick-off.** The integration master proposes an initial roadmap direction, runs `grm-release-planning`, locks a first plan (`v0.1` or `v1.0`) via `grm-release-agreement`, and cuts `version/{X.Y}` — all *before* any building, without per-step user confirmation. The user reviews the locked plan as a milestone, consistent with the Noir posture in [work-paradigm-design.md](work-paradigm-design.md) §(paradigm matrix). |
| **Supervised** (default) | **Prompt-offer.** Onboarding asks (one `AskUserQuestion`): "Setup is complete. Would you like me to draft and lock a first release plan now, or stop here?" Only on an affirmative answer does it run the same `grm-release-planning` → `grm-release-agreement` → cut-`version/{X.Y}` sequence, each step still surfacing its normal Supervised confirmation. |
| **Weiss** (Collaborative) | **Prompt-offer**, same as Supervised, but framed as user-led: the agent offers to *assist* with first-release planning; the user drives the roadmap and scope decisions. |

The version label for the first plan (`v0.1` vs `v1.0`) is itself a planning
decision: Noir picks a sensible default (recommend `v0.1` for a greenfield
project with no shipped surface) and notes it in the proposed plan; the
prompt-offer paradigms surface the choice to the user.

#### 6.4 Interaction with `SKIP ONBOARDING`

`SKIP ONBOARDING` (§4) is a non-interactive path. The bridge respects the
inferred paradigm:

- If the inferred `work-paradigm.value` is **Noir**, the bridge **auto-runs**
  exactly as in §6.3 (this is the whole point of the non-interactive path —
  full hands-off setup *including* first-plan lock).
- If the inferred paradigm is **Supervised** or **Weiss**, the bridge is a
  **no-op** under `SKIP ONBOARDING` — there is no interactive session to
  prompt-offer into. Onboarding stops after seeding the roadmap (§8) and
  prints a one-line pointer: "Run `grm-release-planning` when you're ready to
  scope your first release." This keeps `SKIP ONBOARDING` fully
  non-interactive for the non-autonomous paradigms while still delivering the
  autonomous end-to-end path for Noir.

#### 6.5 Stale-[quickstart.md](../../quickstart.md) fix carried by F1 (design-level note)

F1 also corrects stale onboarding-facing language in `docs/quickstart.md`
(and `docs/features.md` if it carries the same text), across all flavors. The
doc currently reflects pre-v1.6/v1.7 reality. The required corrections are:

| Stale | Correct (current reality) |
|-------|---------------------------|
| `schema-version: 1` examples | `schema-version: 2` (paradigm now active; see §6 of the `grm-onboarding` skill / [work-paradigm-design.md](work-paradigm-design.md) §migration) |
| Work paradigm shown as "preview — not yet active" | Paradigm is **active** at onboarding (`grm-work-paradigm-switch` runs in §3.1) |
| Workflow variants `Efficient / Fast / Cheap` | `Efficient / Fast / Careful-Serial` (the `Cheap` variant was renamed `Careful-Serial`; see [write-capable-workflow-design.md](write-capable-workflow-design.md)) |
| Paradigm names `Autonomous / Collaborative` | Canonical `Supervised / Weiss / Noir` (with `Autonomous`→`Noir`, `Collaborative`→`Weiss` accepted only as input aliases) |

This is a documentation correction only — no schema or skill-logic change
rides on it. It is listed here so F1's author treats it as in-scope and so the
design records the canonical target strings.

#### 6.6 Implementation targets (F1 contract)

F1 edits, canonical-first (`claude-code/` → root → `copilot/`):

- `.claude/skills/grm-onboarding/SKILL.md` — add the §6.2 bridge phase (step 7),
  the §6.3 paradigm-conditional table, and the §6.4 `SKIP ONBOARDING`
  behaviour; reference `grm-release-planning` / `grm-release-agreement` /
  `grm-integration-master` as the planning machinery (do not duplicate their
  logic).
- `docs/quickstart.md` — the §6.5 stale-language corrections.
- `docs/features.md` — same stale-language audit; correct if present.
- Mirror all of the above across flavors (`copilot/` equivalents) per the
  canonical-first rule in `CLAUDE.md`.

The release skills themselves (`grm-release-planning`, `grm-release-agreement`) are
**not** edited by F1 — the bridge calls them as-is.

#### 6.7 Forward-compat note: `grm-issue-tracker` block (v1.12 / I2)

The `grm-issue-tracker` block (§2.5) is a pure-data, optional, additive config
entry. It does not affect `schema-version` (stays at 3) and does not require
any code change in the onboarding flow itself — the bridge, the SKIP path, and
the interview hand-off (§1.3) all remain unchanged. Forward-compat rules:

- **Old configs without the block** (schema-version 3, no `grm-issue-tracker` key)
  continue to work identically. The abstraction synthesizes the roadmap default.
  No re-onboarding or migration needed.
- **Onboarding captures the block at Step 6** (gated on I3 — the `grm-onboarding`
  SKILL.md update). Until I3 lands, new projects that want GitHub Issues may
  write the block manually or via `grm-issue-tracker-switch`; the absence default
  is safe.
- **The `grm-issue-tracker` block is orthogonal to all three dials.** Any
  `work-paradigm` × `workflow-variant` × `model-effort-profile` combination
  is valid with any tracker config. Neither the bridge (§6.2) nor the
  SKIP-path inference (§6.4) reads or derives a tracker value from a dial
  value (or vice versa).
- **The roadmap backend stays the zero-network default.** Absent `grm-issue-tracker`
  block ≡ `roadmap` tracker. The bridge's first-release planning (§6.2) reads
  `docs/roadmap.md` for narrative scope regardless of which tracker is
  configured; this is unchanged.
- **Readers of this doc in a future release** that adds new tracker fields or
  providers: schema-version stays at 3; add the new field as optional and
  synthesize a safe default in the abstraction (same pattern as the block's
  own absence default). No schema bump; no re-interview.

---

### 7. Git-repo-init prerequisite (F4)

#### 7.1 Problem

`grm-repo-init` (§4.1) assumes a git repository already exists — it runs the
branch model (`git init -b main` notwithstanding, its `main`/`dev`/`version`
structure presupposes a repo and a working tree under version control). A
Grimoire scaffold copied into a *non-git* directory (e.g. an unzipped
template, a plain folder) has no repo, so the very first protected-branch /
worktree operation has nothing to stand on. Onboarding must guarantee a repo
exists before `grm-repo-init` runs.

#### 7.2 Ownership decision

**Decision: onboarding owns detection + confirmation + `git init`; `grm-repo-init`
stays focused on the branch model but adds a fail-soft guard.**

Rationale:

1. **Onboarding is the lifecycle orchestrator.** It already sequences
   config-write → paradigm-activate → `grm-repo-init` → `grm-workflow-bootstrap`
   (§1.3 / §4). The "does a repo exist?" question is a lifecycle precondition,
   not a branch-model concern, so it belongs at the orchestration layer.
2. **`grm-repo-init` stays single-responsibility.** Per §5's rationale, `grm-repo-init`
   owns the *branch model* and guards. Folding repo *creation* and the
   user-confirmation UX into it would re-conflate concerns the original design
   deliberately split.
3. **Defence in depth.** `grm-repo-init` is still independently invocable (a user
   can run it directly outside onboarding). So `grm-repo-init` adds a **fail-soft
   guard**: if it detects no git repo (`git rev-parse --is-inside-work-tree`
   fails), it does *not* silently `git init` and proceed — it stops with a
   clear message ("No git repository found. Run the `grm-onboarding` skill, or
   `git init` first, then re-run `grm-repo-init`.") and exits without mutating
   anything. This prevents a half-initialized repo when `grm-repo-init` is called
   standalone in a non-git dir, while keeping repo *creation* owned by
   onboarding.

So: onboarding creates the repo; `grm-repo-init` *requires* one and refuses to
proceed without it.

#### 7.3 Detection + bootstrap procedure (onboarding)

Runs as the **first** onboarding step, before config-write (§3) — it precedes
everything because the config file and later commits must live inside a repo.

1. **Detect.** `git rev-parse --is-inside-work-tree` (suppress stderr).
   - Exit 0 / `true` → a repo already exists → **skip to §3** (idempotent,
     see §7.4).
   - Non-zero → no repo → continue.
2. **Confirm before init** (required; see §7.5).
   - **Interactive path:** `AskUserQuestion` — "This folder isn't a git
     repository yet. Initialize one now (`git init` + an initial scaffold
     commit)? Yes / No." On No, stop onboarding with a message; do not init.
   - **`SKIP ONBOARDING` path:** treat the presence of `SKIP ONBOARDING` as
     implied consent to non-interactive setup, *but still announce it*: log
     "No git repo found; initializing one (SKIP ONBOARDING implies consent)."
3. **Bootstrap the repo.**
   - `git init -b main` (mirror `grm-repo-init`'s default-branch choice so the two
     agree; `grm-repo-init` then builds `dev` / `version/*` off this `main`).
   - Stage the scaffold and make the **initial commit** — one sentence, no
     `Co-Authored-By` trailer (commit discipline, §Commits in `CLAUDE.md` /
     `grm-repo-init`). Message e.g. `chore: initial Grimoire scaffold`.
   - Do **not** create `dev` / `version/*` here — that is `grm-repo-init`'s job.
     Onboarding produces only "a repo on `main` with one commit".
4. Continue to §3 (write config), then §4 calls `grm-repo-init`, whose §7.2
   fail-soft guard now passes because the repo exists.

#### 7.4 Idempotent already-a-repo case

If §7.3 step 1 detects an existing repo, onboarding **skips init entirely** —
no second `git init`, no extra commit, no confirmation prompt. This mirrors
the existing idempotent `grm-repo-init`-skip in §4.1 (skip when `main`+`dev`
already exist) and the sentinel-removal idempotency in §3.5: re-running
onboarding on an already-initialized project is always safe. A repo with
commits but without the Grimoire branch model is *not* re-initialized by
onboarding; `grm-repo-init` (called in §4) brings up `dev` / `version/*` if
missing.

#### 7.5 User-confirmation requirement

`git init` is a filesystem-mutating, repo-creating act and must **never** run
silently on the interactive path — the user might be in the wrong directory,
or intend to add the scaffold to an existing repo elsewhere. The interactive
confirmation in §7.3 step 2 is mandatory. The `SKIP ONBOARDING` path carries
implied consent (the user explicitly opted into non-interactive setup) but
must still log the action so it is visible in the transcript.

#### 7.6 Coverage of both paths

Both onboarding entry points run §7 as their first step:

- **Interactive (§1):** §7 with the `AskUserQuestion` confirmation.
- **`SKIP ONBOARDING` (§2):** §7 with implied-consent + announce.

#### 7.7 Implementation targets (F4 contract)

F4 edits, canonical-first:

- `.claude/skills/grm-onboarding/SKILL.md` — add §7.3 as the new first step of
  both paths (§1 and §2); document the §7.4 idempotent skip and §7.5
  confirmation rule.
- `.claude/skills/grm-repo-init/SKILL.md` — add the §7.2 fail-soft guard
  (detect-no-repo → stop with guidance, mutate nothing) near the top of the
  Initialization procedure; note in Anti-patterns that `grm-repo-init` no longer
  creates a repo from nothing.
- Mirror across flavors (`copilot/` equivalents) per `CLAUDE.md`.

F4 lands **first** in Track A (before F1 and F3) because the repo must exist
before any later onboarding step commits.

---

### 8. Framework-required baseline roadmap seeding (F3)

#### 8.1 Purpose

Every Grimoire project needs a small set of capabilities to be
*self-verifiable* by the workflow — a runnable test command, a smoke/build
command, a non-interactive launch path, and a shape-appropriate inspection
surface. These are **framework-mandated**, not user feature ideas. Onboarding
seeds them into the new project's [roadmap.md](../../roadmap.md) so they are planned (by the §6
bridge) and cannot be silently dropped during scope-trimming.

#### 8.2 Source format and location

**Decision: a versioned Markdown data file shipped with the framework at
`.claude/skills/grm-onboarding/baseline-requirements.md`.**

Justification:

1. **Co-located with its only consumer.** The `grm-onboarding` skill is the sole
   reader; keeping the source list as a sibling of `SKILL.md` makes the
   contract obvious and keeps the skill self-contained for `grm-workflow-bootstrap`
   golden/restore.
2. **Markdown over JSON.** The entries are human-authored, human-reviewed
   prose-plus-table content (capability name, rationale, shape condition,
   cross-references) — exactly what Markdown is good at, and what reviewers
   read in PRs. A JSON sibling would force the rich per-shape guidance into
   awkward string fields. The skill reads the file as structured Markdown
   (a versioned heading + the §8.4 table), not as a machine-parsed schema, so
   Markdown loses nothing here.
3. **Versioned.** The file carries a `baseline-version: N` front-matter / first
   line so the seeding step (and any future re-seed / `grm-sync-from-upstream`
   reconciliation) can detect which baseline a project was seeded from and
   apply additive updates without duplicating already-seeded rows. Bump the
   version whenever an entry is added or its shape condition changes.

The file is **maintained** in `claude-code/` (canonical), mirrored to root and
`copilot/`, and is part of the `grm-workflow-bootstrap` golden baseline so it
restores with the skill set.

#### 8.3 What "seed into roadmap.md" means

Onboarding appends the shape-applicable baseline rows to the project's
`docs/roadmap.md`, each tagged **`framework-required`** (see §8.5). The seeding
reads the active project shape — derived from the GUI-presence answer (§1 step
4 / §2 inference) plus the test/build commands captured by `grm-workflow-bootstrap`
— selects the matching rows from §8.4, and writes them. Seeding is **additive
and idempotent**: a row already present (matched by its stable capability key)
is not duplicated on a re-run; the `baseline-version` line lets a later run add
only newly-introduced rows.

#### 8.4 Per-shape conditional table

The source file encodes this table. "Shape" is GUI / service / library / CLI;
the **all-shapes** rows are seeded unconditionally for every project.

| Shape | Framework-required capability seeded |
|-------|--------------------------------------|
| **All shapes** | (a) a **runnable test command** (assert one exists / scaffold a test harness target); (b) a **smoke / build command**; (c) a **non-interactive launch path** (the project can be started/exercised without an interactive prompt — needed for agent self-verification). |
| **GUI** | A **visual-inspection CLI**: at least one of — headless screenshot capture, render-to-file, DOM-or-scene dump, or an automation endpoint — so an agent can verify UI output without a human at the screen. **Cross-references the UX tier** (see §8.6). |
| **Service** | A **health / readiness probe endpoint** (e.g. `/healthz`) so the project's liveness is checkable non-interactively. |
| **Library** | A **runnable test harness** that exercises the public API (the library has no launch path of its own, so its self-verification surface *is* its test harness — this sharpens the all-shapes test-command row). |
| **CLI** | Covered by the all-shapes non-interactive launch path (a CLI is already a non-interactive surface); no extra shape-specific row beyond asserting `--help` / a smoke invocation exists. |

Each row in the source file specifies: a stable capability key (for idempotent
matching), the human-readable roadmap line, the shape condition, and a
one-line rationale.

#### 8.5 Tagging in [roadmap.md](../../roadmap.md)

Seeded items are written under a dedicated, clearly-labelled group and tagged
so scope-trimming cannot quietly drop them. Recommended form — a
`## Framework-required (baseline)` section in `docs/roadmap.md`, each row
suffixed with a `[framework-required]` tag:

```
## Framework-required (baseline)
<!-- seeded by onboarding from baseline-requirements.md (baseline-version: 1) -->
- Runnable test command [framework-required]
- Smoke/build command [framework-required]
- Non-interactive launch path [framework-required]
- Visual-inspection CLI (headless screenshot / render-to-file / scene dump) [framework-required]  <!-- GUI -->
```

The `[framework-required]` tag is the contract `grm-release-planning` /
`grm-release-agreement` honour: these rows may be *scheduled* into a version but
must not be *removed* during scope-trimming. The HTML comment records the
`baseline-version` for idempotent re-seeds and is distinct from the user's own
roadmap items (which live under their normal headings, untagged).

#### 8.6 GUI cross-reference to the UX tier

The GUI row does not duplicate the UX-design-language workflow — it
**cross-references** it. The visual-inspection CLI is the *agent-facing*
verification surface; the *design* surface is owned by
`grm-design-language-adapt` (→ `docs/design/ux/design-language.md`) and
`grm-ux-demo-build` (→ `ux-demo/`), as set up by `grm-repo-init` §6. The seeded GUI
roadmap line therefore notes: "see UX tier (`grm-design-language-adapt`,
`grm-ux-demo-build`)" so first-release planning (§6) schedules the
visual-inspection capability *alongside* the existing UX deferral/adaptation
rows rather than treating them as unrelated. For a GUI-deferred project,
`grm-repo-init` already adds a `## Backlog` UX row; the §8 GUI baseline row
complements it (verification surface) without colliding.

#### 8.7 Ordering relative to the bridge (F3 seeds, then F1 plans)

§8 seeding runs at onboarding step 6 — **after** the project is initialized
and **before** the §6 first-release-planning bridge (step 7). This is the
load-bearing order from the §"v1.8 onboarding-lifecycle extension" preamble:
F3 populates the framework-required rows so F1's `grm-release-planning` proposal
includes them in the very first plan. F1 must not run before F3.

#### 8.8 Implementation targets (F3 contract)

F3 edits / adds, canonical-first:

- **New file** `.claude/skills/grm-onboarding/baseline-requirements.md` — the
  versioned source list (§8.2) encoding the §8.4 table.
- `.claude/skills/grm-onboarding/SKILL.md` — add the §8.3 seeding step as
  onboarding step 6 (after sentinel removal, before the §6 bridge); document
  the §8.5 tagging and §8.7 ordering.
- `docs/roadmap.md` **template/seed logic** — the skill writes the
  `## Framework-required (baseline)` section per §8.5 into the *adopting
  project's* roadmap (this is skill behaviour; it does not edit
  agentic-scaffolding's own [roadmap.md](../../roadmap.md)).
- `grm-workflow-bootstrap` golden/manifest — include the new
  `baseline-requirements.md` so it restores with the skill set.
- Mirror across flavors (`copilot/` equivalents) per `CLAUDE.md`.

F3 lands **after** F1 in branch order (shared `grm-onboarding` skill, serialized
to avoid conflicts) but its seeding step executes *before* the bridge at
runtime (§8.7).

---

## Acceptance

- [ ] Design doc exists at `claude-code/docs/design/onboarding-design.md`
      and is listed in `claude-code/docs/design/README.md`.
- [ ] Interview prompt order is enumerated (steps 1–4 in §1.2).
- [ ] Hand-off sequence to `grm-repo-init` and `grm-workflow-bootstrap` is fully
      specified (§1.3).
- [ ] `.claude/grimoire-config.json` schema is fully specified: field
      names, types, enums, `schema-version` marker, and `in-development`
      semantics (§2).
- [ ] `in-development` semantics are precisely stated: persisted-but-inert,
      surfaced as "preview — not yet active", read unchanged by future
      features (forward-compat guarantee), §2.4.
- [ ] Example config files are included (§2.6).
- [ ] Sentinel location is recommended (top-of-CLAUDE.md line) with
      explicit justification against the alternative (§3.1).
- [ ] Sentinel detection and routing are specified (§3.3–§3.4).
- [ ] Sentinel removal is specified as idempotent (§3.5).
- [ ] `SKIP ONBOARDING` detection rule is stated (case-sensitive, first
      prompt only, §4.2).
- [ ] Inference rules for all config fields are specified with defaults
      (§4.3).
- [ ] Non-interactive bootstrap sequence is specified (§4.4).
- [ ] `SKIP ONBOARDING` sentinel removal is confirmed to follow the same
      idempotent path (§4.5).
- [ ] Interview-vs-extension decision is recorded with rationale (§5).
- [ ] **(v1.8)** First-release-planning bridge specified: hook point,
      paradigm-conditional auto-vs-offer behaviour, `SKIP ONBOARDING`
      interaction, stale-[quickstart.md](../../quickstart.md) corrections, F1 targets (§6).
- [ ] **(v1.8)** Git-repo-init prerequisite specified: ownership decision
      (onboarding inits; `grm-repo-init` fail-soft guard), confirm-before-init,
      idempotent already-a-repo skip, both paths, F4 targets (§7).
- [ ] **(v1.8)** Baseline-roadmap seeding specified: source format+location
      (`baseline-requirements.md`, versioned Markdown), per-shape conditional
      table, GUI↔UX cross-reference, `framework-required` tagging,
      F3-seeds-then-F1-plans ordering, F3 targets (§8).

---

## Open questions

*(none — all decisions resolved)*

---

## Follow-ups

- A2: implement the sentinel (top-of-CLAUDE.md line) and the detection
  instruction in the shipped `CLAUDE.md`. Wire into `grm-workflow-bootstrap`
  golden/manifest so it is restorable.
- A3: implement the `grm-onboarding` skill per §1–§4 and the schema per §2.
  Wire as the sentinel's call target per §5.
- Future (Work Paradigm release): when Work Paradigm is implemented, read
  `work-paradigm.value` from the config without re-interviewing; remove
  `in-development: true` from that field; bump `schema-version` to `2`.
- **Done (v1.11 / E1, E3, E4):** `workflow-variant` graduated to the active
  **execution-strategy** dial (`{Fast, Efficient, Cheap-Slow}`, default
  `Efficient`); onboarding captures it as an independent Step 3 and activates it
  via `grm-workflow-variant-switch` (§1.3 step 4 / §3.3). The v1.10 Noir →
  `Autonomous` profile coupling was softened to a non-binding hint (E3); the
  three dials are now independently selectable (§1.2). See
  [execution-profiles-design.md](execution-profiles-design.md).
- **F4 (v1.8):** implement the git-repo-init prerequisite per §7 — onboarding
  detect+confirm+`git init`+initial commit; `grm-repo-init` fail-soft guard.
  Lands first in Track A.
- **F1 (v1.8):** implement the first-release-planning bridge per §6 (Noir
  auto / Supervised+Weiss offer) plus the §6.5 [quickstart.md](../../quickstart.md)/[features.md](../../features.md)
  stale-language fix. Lands after F4.
- **F3 (v1.8):** add `baseline-requirements.md` and the §8 seeding step;
  wire into the `grm-workflow-bootstrap` golden. Lands after F1; seeds before the
  §6 bridge runs (§8.7).
