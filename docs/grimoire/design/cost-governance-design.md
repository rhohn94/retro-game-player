# Cost governance — budgets, verbosity, scheduling, and the priority picker

> **Up:** [↑ Design docs](README.md)


> v1.15 "Cost & token governance", **D1 design gate**. This doc defines the
> *model* for the cost-optimization config cluster; phase-2 items implement it
> (skills, config writes, paradigm edits). It **extends** the three composable
> dials established in
> [`execution-profiles-design.md`](execution-profiles-design.md) — it does not
> redefine them. The dials answer *who drives / how dispatched / which tier*;
> this doc adds the *how much may be spent, when, and how loudly* layer that
> sits on top of them. Cross-links:
> [`model-effort-profiles-design.md`](model-effort-profiles-design.md) (the
> tier registry + resolver this layer reads),
> [`token-efficiency-design.md`](token-efficiency-design.md) (the pricing
> mechanics and measurement protocol),
> [`work-paradigm-design.md`](work-paradigm-design.md) (Noir, which gates the
> autonomous behaviours here),
> [`write-capable-workflow-design.md`](write-capable-workflow-design.md).
>
> Tracker issues this design resolves: **#28** (token budget), **#27**
> (per-agent verbosity), **#29** (peak-hour policy), **#12** (token-limit
> observability + Noir pause/resume), **#10** (priority-picker logic), **#14**
> (Steady Steward preset).

## Motivation

The three dials make cost *tunable* (pick a tier, pick a dispatch shape) but
they do not make cost *governed*. Nothing today answers: "how much may this
project spend before it warns or stops?" (#28); "may autonomous work run during
expensive peak hours?" (#29); "what happens when the account nears a hard
token/rate cap mid-run?" (#12); "how verbose should each agent be, and does that
even matter for cost?" (#27); "given I want two of {speed, quality, cost}, what
do I set the dials to?" (#10); and "is there a turnkey long-horizon
cheap-autonomous preset?" (#14).

These six concerns are one coherent cluster: a **cost-governance layer** that
reads the existing dials and adds *limits, schedules, and proximity behaviour*
around them. The dials set the per-item cost; this layer sets the aggregate
envelope and the policy for approaching its edges. We design all six together so
their config surfaces compose cleanly into one `grimoire-config.json`
`cost-governance` block rather than accreting as six unrelated keys.

What changes if we don't ship it: cost stays a per-item knob with no aggregate
ceiling, no schedule awareness, and no graceful behaviour near a cap — exactly
the gap that makes long-horizon autonomous operation (the Steady Steward,
#14) unsafe to leave unattended.

---

## Scope

**Covers (the design — D1):**
- The `grimoire-config.json` **`cost-governance`** block schema unifying all six
  concerns (§A is the schema overview; §B–§G each own one concern).
- **Token budget** (#28): budget value + reset period + thresholds +
  `on-approach` behaviour modes; utilization tracking (session aggregate +
  optional cross-session persistence); proximity + session-end reporting;
  aggregate-only, no per-agent isolation, no hard mid-response block (§B).
- **Per-agent verbosity** (#27): terse/normal/verbose per agent type; the
  **research conclusion** on whether verbosity drives cost; the verbosity↔cost
  linkage and its tie to the model-effort pin (§C).
- **Peak-hour policy** (#29): named windows, mode, timezone; the
  defer-and-reschedule mechanism; autonomous-only applicability (§D).
- **Token-limit observability + Noir pause/resume** (#12): an honest assessment
  of what a run can see from inside; reset cadence; the checkpoint-and-resume
  design (or the documented "rely on scheduled re-entry" verdict) (§E).
- **Priority-picker logic** (#10): the 2-of-3 trade-off → concrete dial settings,
  with the three worked mappings; this feeds the `grm-priority-picker` skill (§F).
- **Steady Steward preset** (#14): composed from the above + the work-scoping
  rule, with the v1.16-dependency flags called out explicitly (§G).
- The README index row.

**Does not cover (non-goals — phase-2 / later):**
- Implementing any skill (`grm-priority-picker`, a budget-tracker, a
  cost-governance-switch) — phase-2 items; this doc only specifies their
  contracts and seams.
- Editing `grimoire-config.json`, the golden baseline, or paradigm files —
  separate phase-2 items.
- The `copilot/` flavor port + golden re-baseline (a later propagation item per
  `CLAUDE.md` §Source of truth; `claude-code/` canonical lands first).
- **Real pricing-window values** (the actual peak hours / rates) — TBD at
  implementation; §D keeps the schema flexible so the values drop in later.
- The **scheduling cadence** (#11 Daily Routines, #13 default Noir wakeup) and
  **unattended landing** (#16 autonomous push) — explicitly **v1.16** building
  blocks; §G ships the Steady Steward *preset definition*, not its wiring.
- Re-deriving the pricing mechanics or the dial definitions — cited from
  `token-efficiency-design.md` and `execution-profiles-design.md`, not
  reproduced.
- A hard mid-response token block (deliberately out of scope — §B v1 is
  proximity reporting + soft `on-approach` modes only).

---

## Design

### A. The `cost-governance` config block (overview)

All six concerns share one additive object in `.claude/grimoire-config.json`.
It is **independent of the three dials** — the dials live in their own fields
(`work-paradigm`, `workflow-variant`, `model-effort-profile`); this block reads
their resolved cost but never writes them. The whole block is optional: an
absent `cost-governance` means "no budget, no schedule restriction, normal
verbosity" — i.e. exactly today's behaviour, so existing configs are
forward-compatible with no migration.

```json
{
  "schema-version": 3,
  "name": "Grimoire",
  "work-paradigm":        { "value": "Supervised" },
  "workflow-variant":     { "value": "Efficient" },
  "model-effort-profile": { "value": "Medium" },

  "cost-governance": {
    "budget": {
      "amount": 5000000,
      "unit": "tokens",
      "reset-period": "daily",
      "thresholds": [50, 80, 95],
      "on-approach": "defer-non-critical"
    },
    "verbosity": {
      "default": "normal",
      "by-agent": { "scout": "terse", "reviewer": "normal", "researcher": "verbose" }
    },
    "schedule": {
      "timezone": "America/New_York",
      "windows": { "peak": "08:00-18:00 Mon-Fri" },
      "mode": "avoid-peak"
    }
  }
}
```

- **No schema-version bump.** Like the model-effort-profile and
  execution-strategy graduations
  ([`execution-profiles-design.md`](execution-profiles-design.md) §F.1), adding
  an *optional* top-level object is additive at the current `schema-version: 3`;
  a reader that lacks the block treats it as "ungoverned." No migration forced.
- **Three sub-objects, each independently optional.** `budget`, `verbosity`,
  `schedule` may each be present or absent. A project can set a budget without a
  schedule, or verbosity without a budget.
- **Read-only of the dials.** The governance layer is a *consumer* of the
  resolver output (`model-effort-profiles-design.md` §E7.5) and the dispatch
  shape (`execution-profiles-design.md` §E); it estimates and tracks cost from
  them. It never overrides a dial — the §A orthogonality contract of the dials
  is preserved.
- **Steady Steward (§G)** is *not* a fourth field; it is a named **preset** — a
  bundle of values across the three dials *plus* this block — applied by a
  switch skill, exactly like the personas in
  `execution-profiles-design.md` §F.3.

### B. Token budget (#28)

A declared aggregate spend ceiling with proximity reporting and soft
approach-behaviour. **Aggregate-only in v1**: one budget for the whole project's
work, no per-agent sub-budgets, and **no hard mid-response blocking** — the
budget shapes *behaviour around thresholds*, it does not abort a generation in
flight (that is neither observable nor safely interruptible from inside a run —
see §E).

#### B.1 Schema

| Field | Type | Meaning |
|---|---|---|
| `amount` | number | The ceiling, in `unit`. |
| `unit` | `"tokens"` \| `"cost-units"` | Token count (sum of all classes, weighted per `token-efficiency-design.md` if cost-units) or an abstract cost unit. Default `"tokens"`. |
| `reset-period` | `"session"` \| `"daily"` \| `"weekly"` \| `"unlimited"` | The window the budget applies over. `session` = this run only; `daily`/`weekly` = a periodic budget needing cross-session persistence (§B.2); `unlimited` = track + report, never approach-behave. |
| `thresholds` | number[] | Percentages (of `amount`) at which to emit a proximity warning. Default `[50, 80, 95]`. Sorted ascending; each crossed at most once per window. |
| `on-approach` | enum (§B.3) | Behaviour once the **highest** crossed threshold is reached. |

#### B.2 Utilization tracking

Cost is accumulated from each agent's measured usage — the same per-class
`{input, output, cache_read, cache_creation}` accounting the **`grm-token-measure`**
skill already extracts from session `.jsonl` transcripts
([`token-efficiency-design.md`](token-efficiency-design.md) §measurement
protocol). v1 tracks the **session aggregate** (the integration master's running
sum across the items it spawned this session).

- **`reset-period: session`** — purely in-memory for the run; no persistence.
- **Periodic budgets (`daily` / `weekly`)** — require **cross-session
  persistence**. The utilization counter persists to a small JSON ledger under
  **`.claude/cache/cost-utilization.json`** (the `.claude/cache/` store is the
  designated persistence location; it is git-ignored, machine-local, and safe to
  delete — deletion just resets the window). The ledger records
  `{window-start, period, accumulated, unit, last-updated}`; on each read the
  governance layer rolls the window forward if `now ≥ window-start + period`
  (resetting `accumulated` to 0). This makes periodic budgets robust across
  multiple sessions and machine restarts without a server.
- **Granularity caveat (honest).** The accumulation is only as accurate as what
  a run can observe of its own + its spawned agents' usage (§E is explicit that
  this may be incomplete). v1 treats the tracked number as a *best-effort
  estimate* for proximity reporting, never as a hard accounting source of truth.

#### B.3 `on-approach` behaviour modes

Once utilization crosses the highest configured threshold, the governance layer
adopts one mode. Modes are **soft** — they change *what work is dispatched and
how loudly*, never interrupt an in-flight response:

| Mode | Behaviour at/after the top threshold |
|---|---|
| `warn-only` | Emit the threshold warning; otherwise no behavioural change. |
| `terse` | Switch every subsequent spawned agent to **terse** verbosity (§C) to shave output cost; warn. |
| `defer-non-critical` | Stop spawning *non-critical* work (anything not on the current release's critical path); finish in-flight items, defer the rest, report what was deferred. Critical-path items still run. |
| `pause-and-report` | Spawn no further work; checkpoint release state (ledger + branch tips, the §E checkpoint) and report a clean stopping point to the user (or, under Noir, schedule resume per §E). |

Mode escalation is monotonic within a window: lower thresholds may emit warnings
while the top threshold triggers the configured mode.

#### B.4 Proximity + session-end reporting

- **Threshold warnings.** When a threshold is first crossed in a window, emit a
  one-line warning: `Budget: 80% of 5M-token daily budget used (4.0M/5.0M).
  Mode: defer-non-critical now active.`
- **Session-end summary.** At the end of any session that tracked a budget,
  report `used / amount (pct)`, the window, per-class breakdown if available
  (reusing `grm-token-measure`'s report table), and any deferred work. This is the
  honest record the user reviews — it is the primary deliverable of the budget
  feature in v1, given that hard enforcement is out of scope.

> **v1 boundaries (explicit).** No per-agent isolation (one aggregate counter,
> not a counter per spawned agent). No hard mid-response blocking. No
> server-side enforcement. These are deliberate: v1 is *governance by reporting
> and soft deferral*, which is the most a run can do honestly given §E's
> observability limits. Hard enforcement is a Follow-up gated on better harness
> usage signals.

### C. Per-agent verbosity (#27)

A per-agent-type verbosity setting — `terse` / `normal` / `verbose` — in the
`cost-governance.verbosity` block (a `default` plus a `by-agent` override map
keyed by the agent role: `grm-scout`, `grm-reviewer`, `grm-researcher`, `grm-verifier`,
`grm-reporter`, `grm-triager`, task-agent, integration-master). It can also be expressed
in the **paradigm layer** (a paradigm may set a baseline verbosity), with the
config `by-agent` override winning.

#### C.1 Research conclusion — does verbosity meaningfully drive token cost?

**Yes, materially — but asymmetrically, and concentrated on output.** Reasoning
from the pricing mechanics in
[`token-efficiency-design.md`](token-efficiency-design.md) (output is the most
expensive token class; cache reads are the cheapest; model tier multiplies
everything):

1. **Output length is the dominant verbosity-driven cost.** Verbosity most
   directly scales the agent's *output* tokens — the priciest class. A verbose
   agent that narrates its reasoning, restates context, and writes long
   summaries spends real money on the highest-multiplier class. This is the
   strongest and clearest linkage.
2. **Input instructions are a smaller, fixed-ish contributor.** Telling an agent
   "be verbose" costs a few input tokens once; telling it "be terse" likewise.
   The *instruction* is cheap; its *effect on output* is what costs. Crucially,
   terse-instruction input is cached behind a stable prefix on warm reads, so its
   marginal cost is near-zero.
3. **Tool-call descriptions are a real, often-overlooked contributor.** Each
   tool call carries a `description` field (this very harness mandates one); a
   verbose agent writes longer descriptions and narrates around each call. Across
   a many-tool-call agent these add up as output tokens. Terse agents that keep
   descriptions to the required 5–10-word minimum measurably cut this.

**Net:** verbosity is a genuine cost dimension, driven ~80% by output length
(incl. tool-call narration) and only marginally by input instructions. It is
therefore worth making verbosity a **co-tunable dimension of the cost surface**,
not a cosmetic preference.

#### C.2 Verbosity as a cost dimension — the linkage to the model-effort pin

Because verbosity is real cost, it is wired alongside the existing cost levers:

- **Low-cost profiles default terse.** When the active **model-effort-profile**
  is **Eco/Budget** (no Opus) or **Low Effort**, the governance layer's verbosity
  **default** is **terse** unless the user overrides — the cost-saving postures
  should not pay for narration. This is documented *next to* the model-effort pin
  concept (`model-effort-profiles-design.md` §E7.3/§E7.5): just as the resolver
  pins `{model, effort}` per band, the governance layer pins a *default
  verbosity* per cost posture.
- **High-quality profiles permit verbose.** **High Effort** (and a deliberately
  quality-prioritized run) **permit** `verbose` — when correctness/auditability
  dominates cost, the extra reasoning output earns its keep (e.g. a `grm-reviewer`
  or `grm-researcher` that should show its work).
- **`normal` is the unpinned default** for the middle profiles (Medium,
  Efficient, Autonomous) — agents are concise by house style but not clipped.
- **Resolution order:** explicit `cost-governance.verbosity.by-agent[role]` →
  `cost-governance.verbosity.default` → profile-derived default (terse for
  Eco/Low) → house default (`normal`). The `on-approach: terse` budget mode
  (§B.3) overrides all of these downward when a budget threshold is hit.

> Verbosity sits on the cost surface next to tier and dispatch: **tier**
> (model-effort) scales per-token rate, **dispatch** (execution-strategy) scales
> fan-out waste, **verbosity** scales output volume. A cost-priority posture
> pulls all three down together; a quality posture relaxes verbosity selectively.

### D. Peak-hour policy (#29)

A schedule that restricts **autonomous/scheduled** work from running during
declared expensive windows. **Interactive work is never affected** — a user at
the keyboard always runs; only unattended/scheduled dispatch consults the
schedule.

#### D.1 Schema

| Field | Type | Meaning |
|---|---|---|
| `timezone` | IANA tz string (e.g. `"America/New_York"`) | The zone the windows are expressed in. Required when `windows` is set. |
| `windows` | map<name, spec> | Named windows. A spec is `"HH:MM-HH:MM Days"` (e.g. `peak: "08:00-18:00 Mon-Fri"`). Multiple named windows allowed (e.g. a separate `weekend-peak`). |
| `mode` | `"off-peak-only"` \| `"avoid-peak"` \| `"unrestricted"` | The policy. `off-peak-only` = autonomous work runs *only* outside every window; `avoid-peak` = same, but a window-overrunning job is allowed to finish; `unrestricted` = windows are informational only (no deferral). Default `unrestricted`. |

> **Real pricing-window values are TBD at implementation.** The schema is
> deliberately a generic named-window grammar (any `HH:MM-HH:MM Days` in any tz),
> *not* hard-coded to a specific provider's peak hours. When real pricing windows
> are known, they drop into `windows` as data — no schema change. The example
> `08:00-18:00 Mon-Fri` is illustrative only.

#### D.2 Defer-and-reschedule mechanism

When autonomous or scheduled work *would start* inside a blocked window (under
`off-peak-only` / `avoid-peak`):

1. **Do not dispatch.** Compute the **next allowed start** = the end of the
   current blocking window (or the next moment outside all windows), in the
   configured tz.
2. **Schedule a wakeup** for that moment. Under Noir this uses the same
   scheduled-re-entry mechanism as §E (`ScheduleWakeup` / a scheduled task);
   the deferred work is recorded so the woken session knows what to resume.
3. **Report** the deferral: `Peak-hour policy: deferring autonomous work until
   18:00 America/New_York (off-peak). 3 items queued.`
4. **On wakeup**, re-check the schedule (the window may have shifted) and proceed
   if now allowed, else re-defer.

This mechanism is **only reached by autonomous/scheduled dispatch** — the Noir
default-dispatch path and any scheduled routine. Interactive `grm-release-phase` runs
skip the schedule entirely. The actual scheduling primitive (cadence, default
wakeup) is a **v1.16** concern (#11/#13); v1.15 defines the *policy + defer
decision*, and §G flags the wiring dependency.

### E. Token-limit observability + Noir pause/resume (#12)

#### E.1 What can a run honestly see from inside? (assessment, with uncertainty)

This is the load-bearing honesty question of #12, and the answer is **partial
and not guaranteed**:

- **Per-agent usage IS observable after the fact.** Session `.jsonl` transcripts
  carry per-message `usage` (`input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`) — this is exactly
  what the **`grm-token-measure`** skill reads
  ([`token-efficiency-design.md`](token-efficiency-design.md)). So a session can
  *accumulate its own and its spawned children's* token usage by reading
  transcripts (the basis for §B tracking).
- **Account-level rate-limit / hard-cap state is NOT reliably exposed
  in-run.** Whether the harness/SDK surfaces a live "you have N tokens left until
  reset" signal, a rate-limit-approaching event, or a structured 429 with a
  reset timestamp **from inside an executing run** is **uncertain** and likely
  **not available** as a first-class, documented signal today. We must not design
  as if a reliable in-run "remaining quota" oracle exists.
- **Reset cadence is also uncertain** — rolling-window vs fixed-window resets are
  a provider/plan detail not introspectable from inside a run.

**Verdict.** Treat in-run cap detection as **best-effort and possibly absent**.
The robust design must **not depend on catching a cap signal mid-response**. The
budget layer (§B) is the *project-declared proxy* for the cap — the user tells us
the budget; we track against it; we behave near it. We do **not** promise to
detect the provider's actual hard cap from inside a run.

#### E.2 Noir checkpoint-and-resume — recommended design

Because in-run cap detection is unreliable, the resume mechanism is anchored on
**(a) the declared budget proxy (§B) crossing `pause-and-report`, and/or (b)
scheduled re-entry**, *not* on catching a hard cap mid-generation:

1. **Checkpoint trigger.** Under Noir, when the budget's `pause-and-report` mode
   fires (§B.3) *or* a graceful stop is otherwise decided, the integration
   master **checkpoints release state** before exiting:
   - the **§5 ledger** in `docs/release-planning-v{X.Y}.md` (which items landed,
     which are in-flight, which deferred) — already the source of truth;
   - the **branch tips** (each spawned agent's branch + last commit SHA, and
     `version/{X.Y}`'s tip) recorded into the ledger / a checkpoint note;
   - the **deferred work queue** (what to resume).
   This reuses existing release-state artifacts — no new persistent format beyond
   a checkpoint note in the ledger and (optionally)
   `.claude/cache/cost-checkpoint.json`.
2. **Schedule resume.** The master schedules a **wakeup after the window
   resets** via `ScheduleWakeup` / the scheduled-tasks primitive — at the next
   off-peak/allowed moment (composing with §D) or after the budget's
   `reset-period` rolls. Because the actual cap reset cadence is uncertain
   (§E.1), the wakeup targets the **declared `reset-period`** (or the next
   off-peak window), which the user controls — not a guessed provider reset.
3. **Resume.** The woken session reads the checkpoint (ledger + branch tips),
   re-establishes context, and continues the release from the recorded point.

> **Honest framing:** this is "checkpoint to a known-good release state, then
> rely on **scheduled re-entry** to resume" — *not* "detect the cap and seamlessly
> pause/resume the in-flight generation." The latter is **not feasible from
> inside a run** given §E.1. We deliver the feasible, robust version: a clean
> checkpoint at a declared/soft boundary + scheduled resume. The scheduling
> primitive itself (default Noir wakeup, #13) is a **v1.16** building block (§G).

### F. Priority-picker logic (#10)

The 2-of-3 trade-off — **pick two of {speed, quality, cost}** — mapped to
concrete settings of the three dials. This is the *logic*; the
**`grm-priority-picker` skill** (built separately, phase-2) is the UI that asks the
user the question and writes the dial values. The logic restates and refines the
mapping table from
[`execution-profiles-design.md`](execution-profiles-design.md) §B, made concrete
for the picker.

| Priority pair | Sacrifices | execution-strategy | model-effort-profile | Rationale |
|---|---|---|---|---|
| **quality + cost** | speed | **Cheap-Slow** (low fan-out, small batches) | **Efficient** or **Autonomous** (High-Effort-where-it-matters: Opus on `review`/`large` only) | Narrow fan-out keeps parallelism-waste low; selective Opus buys quality only where it pays. Not full High Effort (too costly), not Eco (too lossy). |
| **speed + cost** | quality | **Fast** (max fan-out) | **Eco/Budget** (no Opus) or **Low Effort** | Wide cheap fan-out for minimum wall-clock at minimum rate; accept rework risk. |
| **speed + quality** | cost | **Fast** (max fan-out) | **High Effort** (Opus from the `medium` band up) | Pay for both: max parallelism on the top tier. The deliberately expensive corner. |

- **Verbosity rider (from §C).** The picker also sets a verbosity default
  consistent with the pair: cost-priority pairs → `terse`; quality+speed →
  `normal`/`verbose` permitted. This makes the picker tune *all three* cost
  dimensions (tier, dispatch, verbosity) coherently.
- **Autonomy is asked separately.** Per `execution-profiles-design.md` §B, the
  work-paradigm (autonomy) is **not** part of the speed/quality/cost triangle;
  the picker asks it as a separate question and writes `work-paradigm`
  independently.
- **The picker is a pure writer.** It asks the pair (+ autonomy), looks up this
  table, and calls the existing switch skills
  (`grm-workflow-variant-switch`, `grm-model-effort-profile-switch`,
  `grm-work-paradigm-switch`) plus writes `cost-governance.verbosity.default`. It
  embeds no dispatch/tier logic of its own — exactly the seam
  `execution-profiles-design.md` §B reserved for it.

### G. Steady Steward preset (#14)

A named **long-horizon custodian** preset: the configuration for an agent that
quietly maintains a project over a long time horizon at low cost, picking up one
safe piece of work per wake. It is **composed entirely from §A–§F** — it is a
bundle, not a new mechanism.

#### G.1 Composition

| Dimension | Steady Steward value | Source |
|---|---|---|
| **work-paradigm** | **Noir** (autonomous) | the custodian runs unattended |
| **execution-strategy** | **Cheap-Slow** (low fan-out) | §C / `execution-profiles-design.md` — cost posture |
| **model-effort-profile** | **Eco/Budget** *(or **Autonomous**)* | `model-effort-profiles-design.md` — cheap tiers, no/low Opus |
| **cost-governance.budget** | a **low** `daily` budget, `on-approach: defer-non-critical` (or `pause-and-report`) | §B |
| **cost-governance.verbosity** | **terse** default | §C (Eco → terse pin) |
| **cost-governance.schedule** | `off-peak-only` (once real windows known) | §D |
| **work-scoping rule** | **"pick one ready, low-risk, bounded-blast-radius item per wake"** | §G.2 |

In one line: **Steady Steward = Noir × Cheap-Slow × Eco + a low daily budget +
terse + off-peak + the one-item-per-wake scoping rule.**

#### G.2 The work-scoping rule

The custodian must not wake up and try to drain the whole backlog. Each wake it
selects **exactly one** work item that is all of:

- **ready** — no unmet dependencies (the §5 ledger / tracker says it can start);
- **low-risk** — not on a fragile or release-critical path;
- **bounded blast radius** — a contained change (few files, reversible, unlikely
  to cascade) — so an unattended landing is safe.

It does that one item, checkpoints (§E), and exits. The next wake repeats. This
keeps each unattended increment small, cheap, and individually reviewable.

#### G.3 v1.16 dependency flags (EXPLICIT)

The Steady Steward's *definition + design* ships in **v1.15** (this doc + the
phase-2 preset/switch skill that writes the §G.1 bundle). Its **final wiring is
v1.16** — three building blocks are out of scope here and the preset is inert
without them:

- **#11 — Daily Routines** (the scheduling cadence that wakes the custodian on a
  recurring schedule) — **v1.16**.
- **#13 — default Noir wakeup** (the default scheduled-re-entry the custodian
  relies on between wakes — composes with §D/§E's scheduling) — **v1.16**.
- **#16 — autonomous push** (the unattended landing: letting the custodian's
  one-item-per-wake change reach origin without a human at the keyboard;
  pushing is human-gated today per `CLAUDE.md` §Commits) — **v1.16**.

> So v1.15 ships the **preset definition + the composed design**; v1.16 supplies
> the cadence (#11/#13) and the unattended landing (#16) that make it actually
> run on its own. The preset is designed so that wiring is a matter of
> connecting it to those primitives, not redesigning it.

---

## Acceptance

- [ ] Design doc at `claude-code/docs/design/cost-governance-design.md` in the
      house layout; indexed in `claude-code/docs/design/README.md`.
- [ ] A single optional `cost-governance` config block is specified (budget /
      verbosity / schedule sub-objects), additive at schema-version 3 with no
      bump and no forced migration; it reads the dials but never writes them
      (§A).
- [ ] **Token budget (#28):** schema (amount/unit/`reset-period`/thresholds/
      `on-approach`), session-aggregate tracking with optional cross-session
      persistence at `.claude/cache/`, four `on-approach` modes, threshold +
      session-end reporting; aggregate-only, no per-agent isolation, no hard
      mid-response block (§B).
- [ ] **Per-agent verbosity (#27):** terse/normal/verbose per agent type; the
      research conclusion that verbosity *does* drive cost (output-dominated,
      incl. tool-call narration); verbosity made a co-tunable cost dimension with
      Eco/Low → terse default and High Effort → verbose permitted, documented
      next to the model-effort pin (§C).
- [ ] **Peak-hour policy (#29):** named-window schema (windows/mode/timezone),
      defer-and-reschedule mechanism, autonomous-only applicability, real pricing
      windows flagged TBD with a flexible schema (§D).
- [ ] **Token-limit observability + Noir pause/resume (#12):** honest assessment
      (per-agent usage observable post-hoc via transcripts; account cap/reset
      cadence uncertain/likely-absent in-run); checkpoint-and-resume anchored on
      the budget proxy + scheduled re-entry, *not* on catching a cap mid-response
      (§E).
- [ ] **Priority-picker logic (#10):** the three worked 2-of-3 mappings
      (quality+cost / speed+cost / speed+quality → concrete dial settings), feeding
      the separately-built `grm-priority-picker` skill as a pure-writer seam (§F).
- [ ] **Steady Steward preset (#14):** composed from §A–§F (Noir × Cheap-Slow ×
      Eco + low daily budget + terse + off-peak + one-item-per-wake), with #11/#13
      (scheduling) and #16 (autonomous push) explicitly flagged as v1.16 wiring
      (§G).
- [ ] Cross-links present: execution-profiles, model-effort-profiles,
      token-efficiency, work-paradigm, write-capable-workflow.

---

## Open questions

- **Cost-unit weighting.** When `unit: "cost-units"`, the precise per-class /
  per-tier weighting (Opus vs Sonnet vs Haiku multipliers) should reuse
  `token-efficiency-design.md`'s pricing mechanics. The phase-2 budget-tracker
  agent should confirm whether to ship a concrete weighting table now or default
  to raw `tokens` until real rates are pinned. Recommendation: ship `tokens`
  first, add `cost-units` weighting as a follow-up once rates are stable.
- **Verbosity in paradigm layer vs config.** §C allows verbosity in both the
  paradigm content and the config block (config wins). The phase-2 agent should
  decide whether paradigms actually carry a baseline verbosity or whether config
  is the sole surface (simpler). Recommendation: config-only for v1; revisit if a
  paradigm wants a strong default.
- **Hard enforcement.** v1 is soft (report + defer). Whether a future version can
  do harder enforcement depends on §E.1 improving (a real in-run quota signal).
  Tracked as a Follow-up, not committed.

## Follow-ups

- **Phase-2 — budget tracker:** implement the §B utilization accumulator
  (reusing `grm-token-measure`), the `.claude/cache/cost-utilization.json` periodic
  ledger, threshold warnings, the four `on-approach` modes, and the session-end
  summary.
- **Phase-2 — `grm-priority-picker` skill:** ask the 2-of-3 pair (+ autonomy
  separately), look up §F, call the three switch skills, and write
  `cost-governance.verbosity.default`.
- **Phase-2 — verbosity wiring:** add the `cost-governance.verbosity` resolution
  (§C.2 order) to the agent-spawn path and the profile-derived terse default for
  Eco/Low.
- **Phase-2 — peak-hour defer:** implement §D's defer-and-reschedule on the
  autonomous/scheduled dispatch path (the actual scheduling primitive arrives
  v1.16).
- **Phase-2 — Steady Steward preset/switch:** a skill (or persona row) that writes
  the §G.1 bundle across the three dials + the `cost-governance` block.
- **Phase-2 — `copilot/` port + golden re-baseline:** mirror the
  `cost-governance` block documentation into `copilot/` and update the golden
  baseline, after `claude-code/` canonical lands (per `CLAUDE.md` §Source of
  truth). Note: scheduling-dependent behaviour (§D/§E/§G) has no Copilot
  equivalent for the autonomous-scheduling parts.
- **v1.16 wiring (Steady Steward):** #11 Daily Routines (cadence), #13 default
  Noir wakeup, #16 autonomous push — the building blocks that make the preset run
  unattended (§G.3).
- **Backlog — hard budget enforcement:** revisit once §E.1 yields a reliable
  in-run quota/rate signal (a real cap oracle), enabling enforcement beyond soft
  deferral.
- **Backlog — cost-unit weighting table:** a concrete per-class/per-tier weighting
  for `unit: "cost-units"`, once real Anthropic rates are pinned.
