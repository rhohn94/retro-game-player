# Issue Tracker Design

> **Up:** [↑ Design docs](README.md)


## Motivation

The Grimoire scaffolding hard-codes `docs/roadmap.md`'s `## Backlog` section
as the single store for all issues, bugs, and feedback. This works for small
internal projects but breaks down when:

- A project wants a **public bug tracker** (GitHub Issues) without exposing its
  source code to the world.
- An integration master needs to file issues **from multiple contexts** (beta
  feedback, internal Claude observations) routed to different audiences.
- Fetching issue data in every agent session costs tokens at a rate that scales
  badly as the backlog grows.

This design makes the issue tracker a **configurable, pluggable, multi-target
backend**. The `roadmap` backend (zero-network, reads/writes [roadmap.md](../../roadmap.md)) stays
the default — projects that do not opt in see **no behavioural change**. GitHub
Issues is the default external backend; the abstraction is open to a future
third provider. The design is grounded in the R1 spike
(`docs/grimoire/issue-tracker-cost-spike.md`), whose measured access-pattern numbers
drive every cost decision here.

## Scope

**Covered:**

- Provider interface (list / get / create / update / close / label / search) and
  normalized Issue object.
- `roadmap` and `github` backends.
- Session-snapshot read cache (the dominant token lever; K=2 crossover from R1).
- Multi-tracker config block: N named trackers, audience routing, default-for-filing.
- Visibility model (same-repo / separate-repo / multiple-repo topologies) from R1
  §4.
- `grm-feedback-to-issue` skill (FI1): freeform → normalized Issue → filed.
- Reporter agent (RP1/RP2): own-session wrapper around FI1.
- Onboarding Step 6 + §3.4 activation via `grm-issue-tracker-switch`.
- `grm-issue-tracker-switch` skill.
- All-consumer migration plan (M1).
- Composition with existing dials.

**Not covered (follow-ups):**

- The proprietary Grimoire backend (interface stub only).
- Org-level GitHub Projects v2 / GraphQL aggregation.
- Daily-Routines polling.

---

## Ticket layout

Every issue filed through this system must contain three sections: **Overview**,
**Requirements**, and **Acceptance Criteria**. The rationale is that well-formed
issues are independently actionable — a task agent or integration master must be
able to pick up any issue and implement it without follow-up questions. The three
sections map cleanly to the three questions every implementer asks: what is the
problem and who is affected (Overview), what must the solution do (Requirements),
and how do we know it is done (Acceptance Criteria).

**Section definitions:**

- **Overview** — one paragraph: problem statement, who is affected, severity
  signal (blocking / degraded / cosmetic).
- **Requirements** — bulleted must-haves; each item is a concrete thing the fix
  or feature must do.
- **Acceptance Criteria** — verifiable done conditions; each criterion is
  independently checkable without ambiguity.

**Enforcement points:**

- **Filing** (`grm-feedback-to-issue` §0, `reporter/SKILL.md` §0): the filing agent
  must compose all three sections before calling `create`. A missing section
  means the issue is not ready to file; escalate to the Researcher role rather
  than filing a stub.
- **Triage validation** (`triager/SKILL.md` §2 step 0): the Triager checks every
  open issue for the three sections before proceeding with priority/size/milestone
  assignment. Issues missing any section receive the `needs-info` label and a
  comment identifying the gap; triage is blocked until the filer adds the missing
  sections.

---

## 1. Overview & Goals

### 1.1 Pluggable, multi-target backend

One code repo maps to **N named issue trackers**, each with its own provider,
repo, audience, and label set. The integration master, skills, and Reporter
route creates/reads through a single abstraction layer and never call `gh` or
read [roadmap.md](../../roadmap.md) directly.

### 1.2 Roadmap-default zero-behavioural-change

The config default is a **single `roadmap` tracker**. A project that never
touches `grm-issue-tracker` config behaves exactly as today: backlog reads and
writes go to `docs/roadmap.md`. No network, no new tokens.

### 1.3 GitHub default external backend

When a project opts in to GitHub Issues, the `github` backend uses `gh` (already
required for releases) with R1's recommended access pattern: field-filtered
JSON+jq, body-on-demand, server-side filtering, session-snapshot cache,
bounded `--limit`, write batching.

### 1.4 Embedded in onboarding

Issue-tracker choice is a new **Step 6** in the onboarding interview (after
Step 5 — model/effort profile). A new **§3.4 activation** step mirrors §3.1–§3.3
exactly. The `SKIP ONBOARDING` path infers the tracker from prompt keywords.

### 1.5 Cost-disciplined per R1

All GitHub reads follow R1 §5 verbatim. The session-snapshot cache (K=2 crossover)
is the dominant lever: after the first list, every re-read in the same session
costs ~34 tokens instead of ~420. See §4 for the full cache design.

---

## 2. Provider Interface

### 2.1 Normalized Issue object

Every backend produces and consumes this shape. Backends must not leak
provider-specific fields through this object.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Globally unique within this tracker (GitHub: `"42"`; roadmap: `"backlog-slug"`) |
| `number` | `integer \| null` | Provider-native number where applicable (GitHub issue number; null for roadmap) |
| `title` | `string` | One-line summary |
| `body` | `string \| null` | Full description. `null` when loaded without body (title-only list mode). |
| `labels` | `string[]` | Zero or more label strings |
| `state` | `"open" \| "closed"` | |
| `audience` | `"internal" \| "external"` | Which tracker population this issue belongs to |
| `tracker` | `string` | The tracker `name` this issue was loaded from / should be filed to |
| `url` | `string \| null` | Canonical URL (GitHub: issue HTML URL; roadmap: null) |
| `created_at` | `string \| null` | ISO-8601 timestamp (GitHub); null for roadmap |

**Design decision:** `body: null` (not absent) signals that the body was not
fetched. Callers that need the body must call `get()` explicitly. This enforces
the body-on-demand rule at the type level.

### 2.2 Interface methods

Every backend implements these seven methods. All inputs and outputs use the
normalized Issue object above. Error handling: methods throw/return a
structured error `{code, message, tracker}` so callers can distinguish
"not found" from "auth failure" from "network error".

```
list(opts: ListOpts) → Issue[]
get(id: string, opts?: GetOpts) → Issue          // always includes body
create(draft: IssueDraft) → Issue
update(id: string, patch: IssuePatch) → Issue
close(id: string) → Issue
label(id: string, add: string[], remove: string[]) → Issue
search(query: string, opts?: SearchOpts) → Issue[]
```

**`ListOpts`**

| Field | Type | Default | Notes |
|---|---|---|---|
| `tracker` | `string \| null` | null (all trackers) | Filter to a single named tracker |
| `audience` | `"internal" \| "external" \| null` | null (all) | |
| `state` | `"open" \| "closed" \| "all"` | `"open"` | Passed server-side where supported |
| `labels` | `string[]` | `[]` | Server-side label filter |
| `limit` | `integer` | 30 | Per-tracker cap (R1 §5 bounded `--limit`) |
| `include_body` | `boolean` | `false` | Always false in list; callers use `get()` |

**`GetOpts`**: `{ include_body: true }` (always implied for `get()` — the method
always fetches the full issue).

**`IssueDraft`** (create input):

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | `string` | yes | |
| `body` | `string` | yes | |
| `labels` | `string[]` | no | [] |
| `audience` | `"internal" \| "external"` | no | Defaults to `"internal"` for routing |
| `tracker` | `string \| null` | no | Explicit tracker name; null → routing applies (§5.3) |

**`IssuePatch`**: any subset of `{title, body, labels, state, audience}`.

**`SearchOpts`**: `{tracker, audience, limit}` — same semantics as `ListOpts`.

### 2.3 Abstraction layer (routing tier)

The abstraction layer sits above the backends and implements:

- **Multi-tracker routing** for `create()` (§5.3).
- **Aggregation** for `list()` and `search()` across trackers (§5.4).
- **Session-snapshot cache** (§4).
- **Backend selection** per tracker name from config.

Backends only need to implement single-tracker operations. Aggregation and
caching live entirely in the abstraction layer.

---

## 3. Backends

### 3.1 `roadmap` backend (default)

**Description:** Reads and writes the `## Backlog` section of
`docs/roadmap.md` as the issue store. Zero network, zero `gh` calls, behaviour
identical to today.

**list():** Read `docs/roadmap.md`, extract bullet lines from `## Backlog`.
Each bullet becomes an Issue with `id = slugify(title)`, `state = "open"` (the
Backlog is always open), `body = null` (body-on-demand is a no-op for roadmap —
the full line is the body), `audience = "internal"` (Backlog is always internal),
`url = null`.

**get():** Same extraction, filtering by `id` / `number` (matched by slug).
Returns the full bullet as `body`.

**create():** Append a new `- <title>` bullet to `## Backlog`. If `body` is
non-empty, append it as indented sub-text (standard Markdown bullet+continuation).
Labels appear in a trailing HTML comment `<!-- labels: bug, ui -->` for
round-trip fidelity.

**update():** Edit the matching bullet in-place.

**close():** Remove the matching bullet (or optionally move it to a
`## Closed` section if one exists).

**label():** Update the labels HTML comment on the matching bullet.

**search():** Full-text match on title+body within the Backlog bullets.

**Design decision: roadmap stays the release-planning narrative.** Only the
`## Backlog` section is managed by the `roadmap` backend. `## Roadmap`,
`## Framework-required`, and version-history sections are untouched. When a
project migrates to GitHub, the Backlog bullets are not auto-migrated — they
remain as historical context. New issues go to the configured tracker.

### 3.2 `github` backend

**Description:** `gh`-based GitHub Issues backend. Implements R1 §5's
recommended access pattern verbatim.

**R1 rules implemented (required, non-negotiable):**

1. **Always field-filtered JSON + jq.** Every `gh issue list` call uses
   `--json number,title,labels,state` minimum + `--jq '.[] | [.number,.state,.title,.labels] | @tsv'`. Raw `gh issue list` output is never passed to the agent.
2. **Body on demand.** `body` is never included in list queries. `get()` calls
   `gh issue view N --json number,title,body,state,url`.
3. **Server-side filtering before agent sees data.** All `--state`, `--label`,
   and `--search` args are passed to `gh`; never post-filter a full list in the
   abstraction layer.
4. **Session-snapshot cache.** See §4.
5. **Bounded `--limit ≤ 30`.** Default 30; callers may lower it via `ListOpts.limit`.
6. **Write batching.** Multiple `label()` or `update()` calls on the same issue
   in one session are coalesced into a single `gh issue edit` call before the
   session ends. The abstraction holds a pending-write buffer; it flushes on
   session end or on an explicit `flush()` call.

**create():** `gh issue create --title T --body B [--label L...]` against the
tracker's configured `repo`.

**close():** `gh issue close N` against the tracker's `repo`.

**Repo routing:** Every call prefixes `--repo <tracker.repo>`. The `repo` field
in the tracker config is a fully-qualified `owner/repo` string.

**Auth:** Uses `gh`'s ambient authentication (the same auth used by `release`
skills). No additional credentials.

### 3.3 Future proprietary backend (stub)

The interface is open to a third provider. A proprietary backend must implement
the same seven methods and produce normalized Issue objects. The config
`provider` field accepts the string `"grimoire"` (reserved name) when that
backend ships. No implementation in v1.12.

---

## 4. Cached Read Layer

### 4.1 Session-snapshot design

The session-snapshot cache is the dominant token lever identified in R1 §2.
Crossover is K=2: any session with two or more list reads is cheaper with a
snapshot than with repeated live queries.

**Scope:** one snapshot per tracker per session. The session begins when the
first agent turn starts and ends when the agent exits. The cache is
**in-memory only** — it does not persist to disk, so it cannot go stale across
sessions.

**Cache key:** `(provider, repo, filter_hash)` where `filter_hash` is a stable
hash of `{state, labels, limit}` from the `ListOpts`. Different filter
combinations yield different cache entries within the same tracker. This allows
a session that lists open bugs and then lists all issues to cache both without
conflict.

**Rationale for including `filter_hash`:** R1 §4 notes that separate-repo
trackers must be cached independently; the same applies to different filters on
the same tracker. A session that calls `list({state:"open"})` followed by
`list({state:"all"})` must not serve stale open-only data for the second call.

### 4.2 Lazy refresh on writes

When `create()`, `close()`, `label()`, or `update()` is called:

1. Execute the write (or add to the pending-write buffer for coalesced writes).
2. Invalidate the cache entry for `(provider, repo, *)` — all filter variants —
   because the write may affect any filter combination.
3. The next `list()` or `search()` call on that tracker re-populates the cache
   from a fresh live query.

**Write batching interaction:** the cache is invalidated after the batch flush,
not after each individual write accumulation. This preserves the snapshot for
read-heavy sessions that also queue a few writes.

### 4.3 Warm read path

```
list(opts):
  key = cache_key(tracker.provider, tracker.repo, opts)
  if key in session_cache:
    return session_cache[key]         # warm: ~34 tokens (cache_read rate)
  result = backend.list(opts)         # cold: ~420 tokens (output rate)
  session_cache[key] = result
  return result
```

The warm path serves subsequent reads from the prompt cache at the `cache_read`
multiplier (≈0.08× output rate), consistent with the R1 §2 cost model.

### 4.4 Multi-tracker aggregation

For `list({tracker: null})` (all trackers), the abstraction:

1. Checks the cache for each tracker individually.
2. Issues live queries only for cache-miss trackers.
3. Merges results in memory (sorted by `created_at` descending, then by tracker
   name for stability).

Per R1 §3 guidance, tracker reads are parallelized where the runtime supports
concurrent tool calls (e.g. within a workflow fan-out). Sequential reads are
used as a safe fallback for single-agent sessions.

---

## 5. Multi-Tracker Config & Routing

### 5.1 `grm-issue-tracker` config block

The block is added to `.claude/grimoire-config.json` as a peer of the three
existing dials. It is **optional** — absence means "use the roadmap default",
which is forward-compatible with all existing configs (schema-version 3 remains
unchanged; no schema bump).

**Design decision: no schema bump.** Following the v1.10/v1.11 graduation
precedent (model-effort-profile, workflow-variant graduated without bumping
schema-version), the `grm-issue-tracker` block is pure-data that the abstraction
reads live. The `schema-version` stays at 3. Old configs without the block
behave identically to today.

**Full config block schema:**

```json
{
  "schema-version": 3,
  "name": "My Project",
  "work-paradigm": { "value": "Supervised" },
  "workflow-variant": { "value": "Efficient" },
  "model-effort-profile": { "value": "Medium" },
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
}
```

This is the forward-compat default — equivalent to today's behaviour.

**Tracker entry fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | yes | Unique within this project. Used in routing and CLI. |
| `provider` | `"roadmap" \| "github" \| "grimoire"` | yes | Backend selector |
| `repo` | `string \| null` | github: yes, others: null | `"owner/repo"` format |
| `audience` | `"internal" \| "external"` | yes | Default audience for issues filed here |
| `labels` | `string[]` | no | Labels auto-applied to every issue filed here |

**`default-for-filing`:** the tracker `name` used when routing cannot determine
a specific target (§5.3 rule 3). Must refer to a name in `trackers`. Defaults
to `"default"` which always refers to the first tracker (by convention the
`roadmap` or primary tracker).

**Example — two-tracker setup (internal + external):**

```json
"issue-tracker": {
  "trackers": [
    {
      "name": "internal",
      "provider": "github",
      "repo": "acme/internal-issues",
      "audience": "internal",
      "labels": ["from-claude"]
    },
    {
      "name": "public",
      "provider": "github",
      "repo": "acme/public-issues",
      "audience": "external",
      "labels": []
    }
  ],
  "default-for-filing": "internal"
}
```

### 5.2 Absent `grm-issue-tracker` block

If the config has no `grm-issue-tracker` key, the abstraction synthesizes:

```json
{
  "trackers": [
    { "name": "default", "provider": "roadmap", "repo": null,
      "audience": "internal", "labels": [] }
  ],
  "default-for-filing": "default"
}
```

This is identical to the explicit default and ensures `roadmap`-only projects
need zero config changes.

### 5.3 Create routing rules (ordered, first match wins)

1. **Explicit tracker name** — `IssueDraft.tracker` is non-null → route to that
   named tracker. Error if the name does not exist.
2. **Audience match** — `IssueDraft.audience` is non-null → find the first
   tracker whose `audience` equals the draft's audience. If multiple trackers
   match, prefer the one listed first in `trackers`.
3. **Default-for-filing** — fall through to `config.issue-tracker.default-for-filing`.

**Design decision:** audience-match before default ensures that
`grm-feedback-to-issue` can route to the right tracker by setting `audience:
"external"` without knowing the tracker name. This decouples FI1 from the
topology.

### 5.4 List and search aggregation

- `list({tracker: "internal"})` — single-tracker read (cache-keyed to that
  tracker).
- `list({tracker: null})` — aggregate across all trackers in config order;
  merge and deduplicate by `(provider, repo, id)`.
- `list({audience: "external"})` — filter `trackers` to those with
  `audience="external"`, then aggregate across matching trackers only.
- `search(query)` — same tracker selection logic as list; merge results.

---

## 6. Visibility Model

### 6.1 GitHub constraint (permanent)

From R1 §4: GitHub's permissions model ties Issues visibility to repo
visibility. There is **no Issues-only role**. The minimum access to read issues
is `Read` on the repo, which also grants read access to source code.

This is a **topological decision** made at project configuration time, not a
code decision. The abstraction supports three topologies:

| Topology | When to use | Config pattern |
|---|---|---|
| **Same-repo** | Source and issues have the same audience (both fully internal, or both fully public) | Single tracker with `repo: "owner/source-repo"` |
| **Separate-issues-repo** | Issues must be visible without source access (e.g. public bug tracker, private source) | Single tracker with `repo: "owner/issues-repo"` (a dedicated empty or docs repo) |
| **Multiple-issues-repos** | Internal issues for Claude + external issues from users, different access controls | Two trackers, each with its own `repo`; audience routing handles the split |

**Design decision:** the abstraction does not enforce topology — it is the
project owner's responsibility to configure the correct repos. The design doc
and onboarding (Step 6, §9) surface the topology choice and its implications.

### 6.2 Cross-repo cost implication

The separate-issues-repo topology means every tracker read is a cross-repo `gh`
call. With N trackers, the multi-repo aggregation table from R1 §3 applies:

| N trackers | Cold (no cache) | Warm (session cache) |
|---|---|---|
| N=1 | ~420 tok | ~34 tok |
| N=2 | ~840 tok | ~68 tok |
| N=3 | ~1,260 tok | ~102 tok |

The session-snapshot cache is **more critical** in multi-repo setups, not less.
Projects with N≥2 trackers should expect ~12× per-session savings vs cold
re-query once the snapshot is populated.

---

## 7. `grm-feedback-to-issue` Skill (FI1)

### 7.1 Purpose

Converts **freeform feedback** (a user comment, a bug report, a review note, an
agent observation) into a **well-formed normalized Issue** and **files it** via
the abstraction. This is the reusable engine; the Reporter agent (RP1, §8) is
the autonomous channel that wraps it.

### 7.2 Contract

**Input (accepts any combination):**

| Input form | Example |
|---|---|
| Freeform text | `"The onboarding step 3 crashes if no git repo exists"` |
| Structured dict | `{text: "...", audience: "external", labels: ["bug"]}` |
| Piped from another skill | `spawn_task` "flag an issue" invocation |

**Output (normalized Issue draft):**

```
title:    <one concise sentence, ≤80 chars>
body:     <2–4 paragraph markdown: What / Steps to reproduce / Expected vs actual / Context>
labels:   <inferred from feedback: bug | enhancement | question | docs | ...>
audience: <"internal" | "external" — see §7.3>
tracker:  <resolved tracker name — see §7.3>
```

The skill **files the issue** (calls `create()` via the abstraction) and returns
the filed Issue object (including the provider-assigned `number` and `url`).

### 7.3 Audience and tracker resolution

1. If the input explicitly specifies `audience`, use it.
2. Else: infer from keywords — "user reported", "beta tester", "customer",
   "external" → `"external"`; default to `"internal"`.
3. Apply create routing (§5.3) with the resolved audience.

**Design decision:** defaulting to `"internal"` is safe — an internal issue
inadvertently filed externally is a visibility leak; the reverse is a minor
noise addition. The integration master or Reporter can override.

### 7.4 Token efficiency

- FI1 reads the current open issue list (via cache, §4) to detect near-duplicates
  before filing. Uses the title-only list (no bodies). Similarity check is
  title-embedding-free (simple keyword overlap) to avoid extra model calls.
- If a near-duplicate is detected, FI1 reports it and asks (or, under Noir,
  decides autonomously) whether to file anyway or add a comment to the existing
  issue.
- The LLM call for text-to-issue conversion uses the smallest model tier that
  can produce quality output (Haiku / Eco if the profile permits).

### 7.5 Standalone vs Reporter-wrapped invocation

FI1 is **standalone-invocable** by a human (`/feedback-to-issue "..."`), by the
integration master (filing a discovered issue mid-session), or by any skill
(via `spawn_task` "flag an out-of-scope issue" pattern). RP1 wraps FI1 in its
own session — RP1 does **not** re-implement FI1's logic. The contract above is
the shared API; there is no duplication.

---

## 8. Reporter Agent (RP1 / RP2)

### 8.1 Role definition

The Reporter is a **dedicated, own-session, narrow-context** agent whose sole
job is to ingest feedback and file it via FI1. It does not plan releases, merge
branches, or modify code. Its narrow context keeps its session cheap and conflict-safe.

### 8.2 Conflict safety

The Reporter targets the **configured issue tracker**, not any branch in the git
repo. It never touches `version/*`, `dev`, or `main`. It is therefore safe to
run concurrently with an in-flight integration session. The
`protected-branch-guard.sh` hook is irrelevant to the Reporter (it makes no
commits); the Reporter's only write surface is the issue tracker.

### 8.3 Spawn mechanics (RP2)

The Reporter is spawned via `spawn_task` with a minimal prompt:

```
"Reporter: file the following feedback via feedback-to-issue. Audience: <internal|external>.
Feedback: <text>"
```

This is a **one-shot spawn** — the Reporter session runs FI1, files the issue,
reports back the issue number/URL, and exits. It does not idle between tasks.

The integration master uses this pattern when:
- `spawn_task` "flag an out-of-scope issue" is triggered mid-session.
- A review note or user report arrives that should be tracked but not acted on
  immediately.
- A Noir session auto-files a discovery without blocking on the main integration
  loop.

### 8.4 Agent-type taxonomy

The existing taxonomy has two named roles: **task agent** (spawned work-item
session) and **integration master** (owns scope + integration). The Reporter is
a **third named role**:

| Role | Session type | Context width | Git writes | Issue writes | Spawned by |
|---|---|---|---|---|---|
| Task agent | Work-item session | Medium–large | Yes (own branch) | No | Integration master |
| Integration master | Orchestration session | Medium | Merge only | Via Reporter | Human / Noir |
| **Reporter** | Feedback-filing session | Narrow | No | Yes | Integration master / human / any |

The Reporter is **not** a paradigm role — it is available in all three paradigms.
Under Noir, the integration master may auto-spawn Reporters; under Supervised,
the human confirms each spawn (or the integration master prompts once and the
user batch-approves).

### 8.5 Noir interaction

Under Noir, the integration master discovers issues during planning, review, or
merge phases and spawns Reporters autonomously. The Reporter's narrow context
means even a Noir-spawned Reporter is cheap (~Haiku / Eco tier for FI1). The
Reporter never pushes to origin — that remains human-gated.

---

## 9. Onboarding Capture

### 9.1 New Step 6 — Issue tracker

This step is appended after Step 5 (model/effort profile) in the §1 interview.
It follows the same `AskUserQuestion` + default + accepted-values pattern as the
other steps.

**Question:**

> "Choose your issue tracker:
>   - **Roadmap** (default) — issues live in `docs/roadmap.md` `## Backlog`.
>     Zero network, no GitHub required.
>   - **GitHub** — issues live in a GitHub Issues repo (via `gh`). Requires a
>     GitHub repo and `gh` authentication.
>
> You can configure multiple trackers (e.g. internal + external) later with
> `grm-issue-tracker-switch`."

**Accepted values:** `roadmap`, `github` (case-insensitive). Default: `roadmap`.

**If the user answers `github`:** ask one follow-up (still Step 6, not a
separate step — batch it as a clarifying sub-question within the same
`AskUserQuestion`):

> "Enter the GitHub repo for issues (`owner/repo`). Leave blank to configure
> later."

Capture the repo string (or null if blank).

**Optional internal+external split:** if the user specifies a `repo` AND says
they want separate internal/external trackers (keywords: "internal", "external",
"two repos", "separate"), ask:

> "Enter the external-facing issues repo (`owner/repo`) for user-reported issues.
> Leave blank to use the same repo for both."

This produces a two-tracker config (§5.1 example).

### 9.2 SKIP-path inference

| Field | Inference rule | Default |
|---|---|---|
| `provider` | First case-insensitive match of `github` or `roadmap` in prompt | `"roadmap"` |
| `repo` | Pattern `owner/repo` adjacent to `github` keyword in prompt | `null` |
| Dual-tracker | Keywords `internal` + `external` both present in prompt | `false` |

### 9.3 Config written to `grimoire-config.json`

After the interview (or inference):

- **roadmap default (no `github` keyword):** do not write `grm-issue-tracker` to
  config at all — absence is the forward-compat default (§5.2). This keeps
  existing configs clean.
- **GitHub single tracker:** write the `grm-issue-tracker` block with one entry
  (`provider: "github"`, captured `repo`).
- **GitHub dual tracker:** write the `grm-issue-tracker` block with two entries
  (internal + external audiences, each with their captured repo).

### 9.4 §3.4 — Activate the issue tracker

**Immediately after** writing config (§3), and after §3.3 (execution strategy),
run `grm-issue-tracker-switch` with the captured provider and tracker list.

This mirrors §3.1–§3.3 exactly:
- **No file-swap.** The issue tracker is pure data; the abstraction reads config
  live. Writing the config is the activation.
- **Idempotent.** If the value is already active, the skill exits early.
- **If the block is absent** (roadmap default, no config written): `grm-issue-tracker-switch`
  is not called — there is nothing to activate. The abstraction's §5.2 fallback
  provides the default.

**SKIP-path integration:** after inferring the tracker config (§9.2), proceed
directly to §3.4 if a non-roadmap provider was inferred. If roadmap is inferred
(the default), §3.4 is skipped.

### 9.5 Runtime order update

The updated lifecycle order is:

```
§0 git-init
→ §3 write config
→ §3.1 activate paradigm (work-paradigm-switch)
→ §3.2 activate model/effort profile (model-effort-profile-switch)
→ §3.3 activate execution strategy (workflow-variant-switch)
→ §3.4 activate issue tracker (issue-tracker-switch) [if non-roadmap]
→ §4 repo-init + workflow-bootstrap
→ §5 remove sentinel
→ §6.5 baseline-roadmap seeding
→ §7 first-release-planning bridge
```

---

## 10. `grm-issue-tracker-switch` Skill

### 10.1 Purpose

Set or update the `grm-issue-tracker` block in `.claude/grimoire-config.json`.
Supports four sub-commands: `set`, `add`, `remove`, `list`. Validates all
inputs, is idempotent, performs no file-swap (pure-data write).

### 10.2 Sub-commands

**`set <provider> [repo] [--name <name>] [--audience <audience>]`**

Replace the entire `grm-issue-tracker` block with a single tracker. This is the
common onboarding path and the "switch to GitHub" user command.

Example: `issue-tracker-switch set github acme/issues`

Produces:

```json
"issue-tracker": {
  "trackers": [
    { "name": "default", "provider": "github", "repo": "acme/issues",
      "audience": "internal", "labels": [] }
  ],
  "default-for-filing": "default"
}
```

**`add <provider> <repo> --name <name> --audience <internal|external> [--labels l1,l2] [--default]`**

Append a new tracker to the existing list. `--default` promotes this tracker to
`default-for-filing`. Errors if `name` already exists in `trackers`.

**`remove <name>`**

Remove a tracker by name. Errors if the name is `default-for-filing` (the
default tracker cannot be removed without first promoting another). Errors if
only one tracker remains (cannot remove the last tracker).

**`list`**

Print the current `grm-issue-tracker` config in a human-readable table. No writes.

### 10.3 Validation

1. `provider` must be one of `{roadmap, github, grimoire}`. Unknown → abort.
2. `repo` must be non-null when `provider = "github"`. Format must match
   `owner/repo` (at least one `/`, no spaces). Invalid → abort.
3. `repo` must be null when `provider = "roadmap"`.
4. `audience` must be `"internal"` or `"external"`.
5. `name` must be non-empty, no spaces (kebab-case recommended).

### 10.4 Idempotency

- `set` with the same provider+repo+audience as the current single tracker →
  exit early: "Issue tracker is already configured as requested. No changes made."
- `add` with a name that already exists and identical fields → exit early (no
  duplicate). With different fields → error (use `remove` then `add`).

### 10.5 Config write contract

Reads the current config, applies the minimal change to `grm-issue-tracker`, writes
back. **All other fields (`schema-version`, `work-paradigm`, etc.) are left
unchanged.** Schema-version stays at 3.

---

## 11. All-Consumer Migration Plan (M1)

### 11.1 Design

The migration principle: the **roadmap remains the release-planning narrative**
(version history, roadmap items, strategy text). **Issues** (bugs, feedback,
backlog items that are trackable units of work) move to the configured tracker
when one is non-roadmap. Each consumer below is updated to call the abstraction
instead of reading/writing [roadmap.md](../../roadmap.md) directly for issue purposes.

**Key distinction:** `grm-release-planning` reads the roadmap for its *narrative*
(what's in scope, what's in the backlog as future candidates). It does **not**
read issues from the tracker for planning purposes. Issues are separate from the
roadmap narrative. M1 does not change what `grm-release-planning` reads — it changes
where *issue filing* goes.

> **v3.26 promotion (WEB-6):** The M1 advisory tracker read described in §11.2
> has been **narrowly promoted to mandatory** for one issue class: open issues
> carrying the `Grimoire-Requirement` label. As of v3.26, `grm-release-planning`
> Step 2 MUST run
> `python3 .claude/skills/grm-issue-tracker/issue_tracker.py list --state open --labels Grimoire-Requirement`
> and Step 3 surfaces those issues as **origin-D (framework-required tracker
> issues)**, never optional context. The general advisory read for unlabelled
> issues is **unchanged** — this is a promotion of a narrow class, not a
> reversal of the M1 principle. Design authority: `web-app-support-design.md`
> §6.1 (promotion framing) and §6.2 (never-silently-trimmed rule).

### 11.2 Consumer matrix

| Consumer | Current behaviour | Migration change | Priority |
|---|---|---|---|
| `grm-release-planning` skill | Reads `## Backlog` for future candidates | Reads `## Backlog` for narrative candidates (unchanged). Additionally reads from configured tracker for open issues count/summary. | Low (narrative read unchanged; tracker read is additive) |
| `grm-release-agreement` skill | No direct Backlog write | No change needed | None |
| `grm-release-phase-merge` skill | May file follow-up issues via `spawn_task` "flag an out-of-scope issue" pattern | Replace inline `spawn_task` issue-flagging with `spawn_task` Reporter invocation | Medium |
| `grm-release-agent-tracker` skill | Writes status to `release-planning-v{X.Y}.md` ledger (not Backlog) | No change (ledger ≠ issues) | None |
| `spawn_task` issue-flagging pattern | `spawn_task` with "flag an out-of-scope issue" prompt that suggests adding to roadmap Backlog | Update suggested text: file via `grm-feedback-to-issue` instead of editing roadmap.md | Medium |
| Integration master filing | Ad-hoc filing of discovered issues as Backlog bullets | File via Reporter (`spawn_task` Reporter invocation) | High |
| `grm-ux-demo-build` skill | May append UX issues to Backlog | File via `grm-feedback-to-issue` instead | Low |
| `grm-hard-reset` skill | Archives `docs/roadmap.md` including Backlog | Archive is unchanged (file-level); no issue-tracker reset (tracker is external) | Low (document this) |
| `grm-repo-init` skill | Seeds initial `## Backlog` section | Add a note: if `grm-issue-tracker` config exists with a non-roadmap provider, skip seeding `## Backlog` (or seed it as a stub: "Issues tracked in <provider>") | Medium |
| `grm-sync-from-source` skill | Mentions Backlog in sync notes | Update mentions to refer to "the configured issue tracker" generically | Low |
| `grm-onboarding` skill | No direct Backlog write | Gets new Step 6 + §3.4 (§9 above) | High (gated on I2/I3) |

### 11.3 Serialize order for M1 branch

M1 edits many files. To minimize conflicts, serialize edits in this order:

1. [integration-workflow.md](../integration-workflow.md) (Reporter taxonomy docs, referenced by RP2)
2. `.claude/skills/grm-integration-master/SKILL.md` (Reporter spawn pattern)
3. `.claude/skills/grm-release-phase-merge/SKILL.md`
4. `spawn_task` issue-flagging documentation (cross-skill pattern update)
5. `.claude/skills/grm-repo-init/SKILL.md`
6. `.claude/skills/grm-ux-demo-build/SKILL.md`
7. `.claude/skills/grm-sync-from-source/SKILL.md`
8. `docs/grimoire/integration-workflow.md` (final — accumulates Reporter + M1 notes)

---

## 12. Composition with Existing Dials

### 12.1 Orthogonality

The `grm-issue-tracker` block is a **fourth independent config entry**, not a dial
in the speed/quality/cost triangle sense. It does not interact with `work-paradigm`,
`workflow-variant`, or `model-effort-profile`. Any combination is valid:

| Paradigm | Execution strategy | Profile | Tracker | Notes |
|---|---|---|---|---|
| Supervised | Efficient | Medium | roadmap | Today's default — zero change |
| Noir | Fast | Autonomous | github | Autonomous + cheap tracking |
| Weiss | Cheap-Slow | Eco/Budget | github (dual) | User-led + external feedback channel |

### 12.2 Noir-specific interactions

Under **Noir**, the integration master:
- **Auto-files** discovered issues via Reporter (no user confirmation per-filing).
- May **batch-spawn** Reporters at the end of a phase merge for all flagged
  items.
- The Reporter session runs at the configured `model-effort-profile` tier
  (typically Eco/Haiku for Noir's narrow context) — cheap.

Under **Supervised**, each Reporter spawn is confirmed by the user (standard
`spawn_task` confirmation gate).

Under **Weiss**, the user decides when to file; the integration master offers
but does not auto-file.

### 12.3 Workflow interaction

The `grm-issue-tracker` abstraction is not a Workflow. It is called from within
skills and agent sessions. Read-capable Workflows (e.g. `grm-release-planning`
Workflow) may call `list()` via the abstraction for the additive issue-count
summary (§11.2) without triggering network calls if the roadmap backend is
active — the roadmap backend reads from the working tree, which is already in
the Workflow's read scope.

---

## 13. Follow-ups / Out of Scope

### 13.1 Proprietary backend (deferred)

The interface (§2) and config schema (§5.1) reserve `provider: "grimoire"`. No
implementation in v1.12. When it ships, it plugs in as a backend with no
abstraction-layer changes.

### 13.2 Org-Projects / GraphQL aggregation (deferred)

GitHub Projects v2 provides cross-repo issue aggregation with finer-grained
access control via GraphQL. This is a materially different API from `gh issue`
and would require a separate `github-projects` provider. Deferred to a future
release (Steady Steward dependency candidate).

### 13.3 Daily-Routines polling (deferred)

Scheduled Reporter runs (poll external feedback channels, auto-file issues on a
cron) pair with the Steady Steward design and the Daily-Routines research spike.
Not in v1.12 scope.

### 13.4 Issue-to-roadmap promotion

A filed issue becoming a roadmap backlog candidate (bidirectional sync) is a
UX decision deferred to post-v1.12. The abstraction supports it architecturally
(`create()` on the `roadmap` backend appends to Backlog), but the workflow is
not designed here.

---

## Acceptance

- [ ] The normalized Issue object is used consistently across all backends; no
      provider-specific fields leak through.
- [ ] The `roadmap` backend reads/writes only `## Backlog`; other roadmap
      sections are untouched.
- [ ] The `github` backend passes all seven R1 rules: field-filtered JSON+jq,
      body-on-demand, server-side filtering, session-snapshot cache (K=2),
      bounded `--limit ≤ 30`, write batching, roadmap-default zero-network.
- [ ] The session-snapshot cache key is `(provider, repo, filter_hash)`; writes
      invalidate all filter variants for that tracker only.
- [ ] `list({tracker: null})` aggregates across all configured trackers; a
      single-tracker `list()` reads only that tracker's cache entry.
- [ ] Create routing: explicit name → audience match → default-for-filing
      (first match wins).
- [ ] Absent `grm-issue-tracker` config is treated identically to a single `roadmap`
      tracker named `"default"`.
- [ ] `issue-tracker-switch set roadmap` with no repo produces a clean roadmap
      config and does not write `repo` to the block.
- [ ] `grm-feedback-to-issue` filed issue appears in the tracker within the same
      session; the cache is refreshed.
- [ ] Reporter is spawnable from integration master, produces a filed issue,
      and makes no git commits.
- [ ] Onboarding Step 6 defaults to `roadmap`; selecting `github` prompts for
      repo; a two-repo setup produces a dual-tracker config.
- [ ] Schema-version stays at 3 throughout; old configs without `grm-issue-tracker`
      continue to work.
- [ ] All M1 consumers route issue filing through the abstraction; no skill
      directly appends Backlog bullets (except the `roadmap` backend itself).

---

## Open Questions

*(empty — decisions made above; see §13 for deferred work)*

---

## Follow-ups

- Proprietary backend implementation (§13.1).
- Org-Projects / GraphQL aggregation backend (§13.2).
- Daily-Routines polling and scheduled Reporter (§13.3).
- Issue-to-roadmap promotion workflow (§13.4).
- `issue-tracker-switch list` UX: consider adding a `--json` flag for
  machine-readable output (useful for Workflows that inspect the tracker config).

---

## Epic support

Epics are a first-class grouping concept layered on top of the existing Issue
object. They require no new backend operations — Epics use the same nine-operation
interface as plain issues.

### Data model

Two optional fields are added to the normalized `Issue` object:

| Field | Type | Default | Description |
|---|---|---|---|
| `issue_type` | `"issue" \| "epic"` | `"issue"` | Distinguishes Epics from plain issues |
| `parent_epic_id` | `string \| null` | `null` | ID of the parent Epic; `null` for standalone issues and Epics themselves |

These fields are stored in memory on the `Issue` dataclass. Because the roadmap
and GitHub backends do not have a native Epic concept, `issue_type` is inferred
at read time via the presence of the `epic` label: any issue carrying the `epic`
label is treated as an Epic when filtering with `list(issue_type="epic")`.

### One-level nesting rule

Epics can be parents; they cannot be children of other Epics. Attempting to
call `create()` with both `issue_type="epic"` and a non-null `parent_epic_id`
raises `TrackerError("validation_error", …)` immediately, before any backend
call is made. This is enforced in the `IssueTracker` routing layer, so it
applies equally to all backends.

### Epic label

When `issue_type="epic"` is passed to `create()`, the abstraction layer
automatically:

1. Prepends `"epic"` to the labels list (if not already present).
2. Calls `ensure_label("epic")` on the target backend before filing (github:
   idempotent `gh label create`; roadmap: no-op).
3. For the `roadmap` backend: prefixes `[EPIC]` in the stored title so Epics are
   visually distinguishable in `docs/roadmap.md`.

### Interaction with milestones

Epics themselves should carry the same milestone label as their child issues
(or the milestone of the first/majority child). When creating an Epic during
triage, the Triager should apply the relevant milestone label to the Epic at the
same time it links child issues via `parent_epic_id`. This keeps the Epic visible
in milestone-scoped planning reads without requiring a separate milestone pass.

### Creation threshold

Create an Epic when **3 or more related issues share a common goal**. Below
that threshold, plain issues with shared labels are sufficient. Above it, the
overhead of an Epic (one extra issue + child-linking) is justified by the
planning clarity it provides to the integration master at dispatch time.

Child issues are linked by passing `parent_epic_id=<epic_id>` when calling
`create()` for each child. The Epic's own `parent_epic_id` must remain `null`.

### Filtering

`IssueTracker.list(issue_type="epic")` returns only Epic issues (identified by
the `epic` label). `list(issue_type="issue")` returns only non-Epic issues.
Omitting `issue_type` (or passing `None`) returns all issues regardless of type —
the default, backward-compatible behavior.

### CLI

```bash
# Create an Epic
python3 .claude/skills/grm-issue-tracker/issue_tracker.py create \
  --title "Unify auth system" --body "..." --issue-type epic

# Create a child issue linked to the Epic
python3 .claude/skills/grm-issue-tracker/issue_tracker.py create \
  --title "Migrate OAuth flow" --body "..." --parent-epic-id "unify-epic-epic"

# List only Epics
python3 .claude/skills/grm-issue-tracker/issue_tracker.py list --issue-type epic

# List only plain issues (exclude Epics)
python3 .claude/skills/grm-issue-tracker/issue_tracker.py list --issue-type issue
```

---

## §Extension — v3.26: `ensure_label` + `Grimoire-Requirement` protected label

### §E.1 `ensure_label` operation

A ninth operation is added to the interface (v3.26, WEB-5):

```
ensure_label(name: str, tracker: str | None) → None
```

Per-provider semantics:

| Provider | Behaviour |
|---|---|
| `github` | `gh label create <name> --repo <tracker.repo>` — idempotent: "already exists" exit is treated as success. Any other non-zero exit raises `TrackerError("gh_error", …)`. |
| `roadmap` | No-op. Roadmap labels are free-form strings embedded in the bullet's HTML comment; any value is valid. |
| `grimoire` | Raises `TrackerError("not_implemented", …)` — reserved for a future backend. |

`IssueTracker.ensure_label(name, tracker=None)` routes to the
default-for-filing tracker when `tracker` is `None` (same rule as `create()`
routing step 3). The CLI exposes this as the `ensure-label <name>` subcommand.

**Auto-ensure integration:** `IssueTracker.create()` and `IssueTracker.label()`
automatically call `ensure_label` on each requested label before applying it.
This prevents a "label rejected as unknown" error on GitHub without requiring
callers to pre-create labels. The auto-ensure is a no-op for roadmap trackers.

The bundled MCP server (`.claude/mcp-servers/issue-tracker/server.py`) exposes
`ensure_label` as a dedicated tool (9th tool, added alongside
`create_issue`/`label_issue`'s implicit auto-ensure path). Callers that need
idempotent label creation without filing an issue can call `ensure_label`
directly.

### §E.2 `Grimoire-Requirement` protected label

`Grimoire-Requirement` is the first **protected framework label** (taxonomy row
added in `docs/design/issue-label-taxonomy.md` §Protected framework labels).

**Semantics:**

- **Audience:** always `internal`.
- **Priority:** always `p1-high` or higher — never downgraded.
- **Planning origin:** issues carrying this label are **mandatory, always-
  prioritized origin-D inputs** for `grm-release-planning` (the §11.1 advisory
  read, narrowly promoted to mandatory for this class — `web-app-support-design.md`
  §6.1). They may be scheduled across versions but must **never be silently
  dropped** from planning (§6.2 never-trim rule, implemented by WEB-6).
- **Triager carve-outs** (see `triager/SKILL.md` §9): the Triager must never
  remove the label, stale-close, or downgrade a tagged issue.
- **`grm-feedback-to-issue` closed vocabulary** (see `feedback-to-issue/SKILL.md`
  §9): the label is admitted as a valid `labels` value; only applied when the
  caller explicitly requests it (not inferred from feedback text).

**Ensure-label plumbing:** `IssueTracker.create()` auto-ensures the label
exists (via §E.1) before filing a tagged issue, so the first `Grimoire-Requirement`
issue on a GitHub tracker creates the label automatically. On roadmap trackers,
the auto-ensure is a no-op (labels are free-form).

---

## Milestone enforcement

Milestone labels scope issues to a specific release version and prevent unscoped
issues from being accidentally dispatched in the wrong release.

### Label format

| Label | Meaning |
|---|---|
| `milestone:vX.Y` | Issue is scoped to release vX.Y (e.g. `milestone:v3.36`) |
| `milestone:backlog` | Issue is undated; not assigned to any specific release |

The label name must use this exact format. Partial versions (e.g. `milestone:v3`)
and freeform strings are not valid. The `milestone:` prefix is fixed; only the
version suffix varies.

### Triager responsibility

The Triager assigns milestone labels at triage time, immediately after §Label
assignment and §Epic creation, **before marking any issue Ready**. Procedure:

1. Read `docs/roadmap.md` §v{X.Y} for the in-flight release to understand scope.
2. For each triaged issue: if it fits the current release → assign
   `milestone:v{X.Y}`; if a future version is clear → assign that version; if
   undated → assign `milestone:backlog`.
3. Issues missing a milestone label at triage completion are incomplete — the
   Triager must not exit without assigning a milestone to every issue it processed.

Full procedure: `triager/SKILL.md` §Milestone assignment.

### Integration master responsibility

The integration master enforces milestone labels as a **hard pre-dispatch gate**
in `release-phase/SKILL.md` Step 3.5:

1. Before dispatching any work item for release vX.Y, check that every planned
   issue carries the label `milestone:vX.Y`.
2. If any planned issue is missing the label (or carries only `milestone:backlog`):
   **STOP**. Do not dispatch any items. Emit a clear error listing the unlabeled
   issues and instruct the user to run the Triager with milestone-assignment scope.
3. Only when all planned issues carry the correct `milestone:vX.Y` label does the
   integration master proceed to dispatch.

This gate is non-advisory — it cannot be bypassed or configured away.

### Rationale

Without milestone enforcement:
- An issue triaged but not yet scoped to a version can slip into dispatch during a
  release phase, delivering work the release plan did not authorize.
- Backlog items (`milestone:backlog`) can accidentally be picked up in a release
  cycle they were not intended for.
- Post-release audits cannot reliably determine which issues were intentionally
  part of a given release.

The two-role contract (Triager assigns, integration master validates) ensures the
label is present before it matters — at dispatch time — while keeping the
assignment responsibility at triage time where the planning context is fresh.
