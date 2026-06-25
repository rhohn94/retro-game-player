# Default issue-label & audience taxonomy

> **Up:** [↑ Design docs](README.md)


> Recommended label set seeded (opt-in) at onboarding for GitHub trackers, and
> the `audience` routing convention. Part of v1.31 (#69). No-op for the roadmap
> provider. Wired through the issue-tracker abstraction, not raw `gh`.

## Audience routing

Every issue carries an `audience` that selects the destination tracker:
- `internal` — engineering backlog (Claude + maintainers).
- `external` — user / beta-tester facing (optionally a separate repo).
Routing is resolved by the issue-tracker abstraction from `audience`; consumers
never name a tracker.

## Recommended label taxonomy (type × area × priority × size × complexity × component)

| Dimension | Labels |
|---|---|
| **type** | `bug`, `enhancement`, `documentation`, `question`, `security` |
| **area** | `code-quality`, `doc-quality`, `token-efficiency`, `autonomy`, `defaults-quickstart` (extend per project) |
| **priority** | `p0-critical`, `p1-high`, `p2-normal`, `p3-low` |
| **size** | `size:xs`, `size:s`, `size:m`, `size:l`, `size:xl` |
| **complexity** | `complexity:simple`, `complexity:moderate`, `complexity:complex`, `complexity:research` |
| **component** | `component:<name>` (free-form, seeded at onboarding; multiple allowed per issue) |

## Size dimension (dispatch token band)

Maps to the token band used for model/effort selection at dispatch. Applied at triage.
Drives: model/effort at dispatch.

| Label | Band | Description |
|---|---|---|
| `size:xs` | ≤ 15K tokens | Simple/narrow change |
| `size:s` | 15K–40K tokens | New sub-feature with doc update |
| `size:m` | 40K–80K tokens | New module across 3–5 files |
| `size:l` | 80K–200K tokens | Multi-file architecture change |
| `size:xl` | > 200K tokens | Major system-wide change |

**Assignment rule:** always assign a size label at triage. Use the token-band estimates
from `grm-release-planning` skill output. Default to `size:m` when size is unknown.

## Complexity dimension (model tier)

Maps to the model tier selected at dispatch. Applied at triage when the solution
approach is reasonably clear. Drives: model tier at dispatch.

| Label | Description | Model tier |
|---|---|---|
| `complexity:simple` | Clear scope, well-understood implementation | haiku / sonnet |
| `complexity:moderate` | Some design judgment needed | sonnet |
| `complexity:complex` | Architectural tradeoffs or multi-system impact | sonnet / opus |
| `complexity:research` | Problem/solution not yet clear; requires spike first | opus |

**Assignment rule:** assign when the solution approach is reasonably clear. Default
to `complexity:moderate` when uncertain.

## Component dimension (system area)

Free-form per-project labels of the form `component:<name>`, where `<name>` is a
system component (e.g. `component:issue-tracker`, `component:integration-master`,
`component:release-pipeline`). Seeded at onboarding alongside the `area` labels;
projects extend the set as their system grows. Multiple component tags are allowed
per issue — an issue touching two components gets both labels. Applied at triage.
Drives: conflict detection at parallel-dispatch planning (integration master uses
component overlap to detect file-set conflicts).

## Priority dimension (work ordering)

Extended priority set replacing the legacy `p0-critical` / `p1-high` / `p2-normal` /
`p3-low` scheme. Applied at triage. Drives: ordering within a milestone.

| Label | Description |
|---|---|
| `priority:critical` | Blocks release; immediate attention |
| `priority:high` | Important; current sprint |
| `priority:normal` | Default; next available slot |
| `priority:low` | Nice-to-have; backlog |
| `priority:very-low` | Someday/maybe; lowest priority |

**Assignment rule:** always assign a priority label at triage. Default to
`priority:normal`. Escalate to `priority:critical` or `priority:high` only with
explicit justification stated in a label comment or triage note. Legacy `p0`–`p3`
labels remain recognized for backward compatibility; prefer the `priority:*` form
for new issues.

## Protected framework labels

These labels are managed by Grimoire itself. They carry special semantics that
override normal triage and planning rules — see carve-outs in
`feedback-to-issue/SKILL.md` §9 and `triager/SKILL.md` §9.

| Label | Audience | Priority | Semantics |
|---|---|---|---|
| `Grimoire-Requirement` | `internal` | Always treated as `p1-high` or higher — never downgraded | A framework-mandated requirement (e.g. the Admin Console catalog entry, v3.26). Issues carrying this label are **always-prioritized planning origins** (origin-D; [issue-tracker-design.md](issue-tracker-design.md) §11.1 + `web-app-support-design.md` §6). They may be **scheduled** across versions but must **never be silently dropped** from planning. The Triager must **never** remove this label, stale-close, or downgrade a tagged issue. The label is created via `ensure_label` (provider-aware, idempotent) when a tagged issue is first filed. |

## Seeding (idempotent, provider-aware)

At onboarding Step 6, **for GitHub trackers only**, offer to seed the taxonomy:
- create each label if absent (skip existing — idempotent);
- never delete or recolor an existing label;
- no-op entirely for the `roadmap` provider (labels are not a roadmap concept).

Seeding goes through the issue-tracker abstraction's `ensure_label` operation
(v3.26), so it honors routing and caching. Projects extend the `area` set as
their domains grow.

The `Grimoire-Requirement` protected label is created automatically via
`ensure_label` whenever it is first applied (e.g. during catalog filing); it
does not need to be in the opt-in seed list — the ensure-label plumbing
guarantees it exists on the provider before it is used.
