# Autonomy scheduling & ops — default Noir wakeup, autonomous push, and the cadence engine

> **Up:** [↑ Design docs](README.md)


> v1.16 "Autonomy scheduling & ops", **D1 design + research gate**. This doc
> defines the *model* for the scheduling/landing layer that makes long-horizon
> autonomous operation actually run unattended; phase-2 items implement it
> (paradigm edits, `push-guard.sh` config consult, config schema). It **completes
> the wiring** that
> [`cost-governance-design.md`](cost-governance-design.md) §E (checkpoint-and-
> resume), §D (peak-hour defer), and §G (Steady Steward preset) explicitly
> deferred to v1.16. It does **not** redefine the budget/verbosity/schedule
> config block, the three composable dials, or the checkpoint format — it
> consumes them.
>
> Cross-links:
> [`cost-governance-design.md`](cost-governance-design.md) (the budget proxy,
> the §E checkpoint anchored on the §5 ledger, the §D peak-hour windows, the §G
> Steady Steward composition this doc supplies the engine for),
> [`execution-profiles-design.md`](execution-profiles-design.md) (the three
> dials — work-paradigm gates everything here),
> [`write-capable-workflow-design.md`](write-capable-workflow-design.md) (the
> Careful-Serial variant whose isolation overhead §4 assesses),
> [`agent-roles-design.md`](agent-roles-design.md) (Triager/Reporter, candidate
> drivers for scheduled grooming routines).
>
> Tracker issues this design resolves / researches: **#13** (default Noir
> wakeup — the cadence engine), **#16** (autonomous-push config — unattended
> landing), **#11** (Daily Routines research — the `schedule` skill as an
> automation channel), **#17** (worktree-isolation overhead research).

## Motivation

The cost-governance layer (v1.15) designed an autonomous custodian — the
**Steady Steward** — that wakes on a cadence, picks one safe item, lands it, and
sleeps. But it shipped *inert*: `cost-governance-design.md` §G.3 flagged three
building blocks as explicitly out of scope and required for the preset to run on
its own:

- **#13 — default Noir wakeup**: the scheduled re-entry the master relies on
  between checkpoints. §E.2 of the cost-governance doc designed the
  *checkpoint* (anchored on the §5 ledger) and named `ScheduleWakeup` /
  scheduled-tasks as the resume primitive — but left the *default-on wakeup
  behaviour* (when the master schedules its own resume, and what it does on
  wake) undefined.
- **#16 — autonomous push**: the unattended landing. Pushing to origin is the
  framework's *one* human gate (`CLAUDE.md` §Commits, enforced by
  [`push-guard.sh`](../../.claude/hooks/push-guard.sh)). A custodian that can
  never push can never finish a release alone.
- **#11 — Daily Routines**: whether the `schedule` skill (scheduled remote-agent
  cron routines) is a viable, cost-aware automation channel for recurring
  maintenance, and which uses are worth wiring.

A fourth, orthogonal ops question rides along: **#17** — does the
Careful-Serial workflow variant's per-agent isolated worktree earn its
setup/disk cost for trivial single-file edits, or should it operate directly on
the staging branch?

Together #13 (the cadence engine) and #16 (unattended landing) **complete the
Steady Steward preset**: with them, `Noir × Cheap-Slow × Eco + low daily budget
+ one-item-per-wake` (cost-governance §G.1) becomes a configuration that
genuinely maintains a project over a long horizon with no human at the keyboard
— while #16's conservative design keeps the human gate intact by default.

## Scope

**In scope (this design doc):**

1. The **default Noir wakeup** rule (#13) — when the master schedules its own
   resume, which primitive it uses (`ScheduleWakeup` in-loop vs.
   `scheduled-tasks`/cron for longer gaps), what it re-reads on wake, and the
   exact change to the Noir paradigm content. Supervised/Weiss are unchanged
   (human-driven resumption).
2. The **autonomous-push config** (#16) — the opt-in `autonomous-push` flag
   schema in `grimoire-config.json` (default `false`), how `push-guard.sh`
   consults it, and the safety rails.
3. **Daily Routines research** (#11) — a findings assessment of the `schedule`
   skill as an automation channel: cost reasoning and a ranked shortlist of
   viable daily-cadence uses.
4. **Worktree-isolation overhead research** (#17) — a recommendation on
   skipping isolated worktrees for Careful-Serial + trivial edits.

**Out of scope (phase-2 / other items):**

- Editing the Noir paradigm files, `push-guard.sh`, or `grimoire-config.json` —
  this is a design gate; §1–§2 specify *what* changes, phase-2 makes the edits.
- The budget/verbosity/peak-hour config block and the checkpoint format — owned
  by `cost-governance-design.md`; consumed, not redefined, here.
- The Steady Steward preset/switch skill itself — owned by cost-governance
  phase-2; this doc supplies the engine it depends on.
- Building the scheduled routines from §3 — §3 is research feeding a *future*
  automation release, not a v1.16 build.
- The `copilot/` flavor — Copilot has no scheduling/wakeup primitive and no
  write-capable Workflow tier; the autonomous-scheduling parts have no Copilot
  equivalent (mirror only the config-schema documentation, per `CLAUDE.md`
  §Source of truth).

## Design

### 1. Default Noir wakeup (#13) — the cadence engine

#### 1.1 The rule

**Under Noir only**, when the integration master pauses with **work
outstanding**, it schedules its own resume rather than waiting for a human to
re-open the session. "Work outstanding" means any of:

- a **session/token-limit checkpoint** fired (cost-governance §B
  `pause-and-report` crossed, or a graceful stop decided) with un-landed ledger
  rows remaining;
- a **long-running background task** the master is waiting on (e.g. a spawned
  agent's branch not yet reported, a long build) where there is nothing to do
  *now* but there will be soon;
- an **end-of-turn with queued work** — the master reached the end of its
  current activity but the §5 ledger still shows ready, un-landed items (and the
  milestone is not yet reached).

This is the **default-on** behaviour for Noir: the master does not need to be
told to reschedule. It is the inverse of the Supervised/Weiss contract, where a
pause always hands control back to the human.

**Supervised and Weiss are unchanged.** They keep **human-driven resumption**:
when the master pauses, it reports a clean stopping point and waits for the user
to re-engage. No auto-wakeup is ever scheduled under these paradigms. This is
the existing behaviour and must remain the default for the two human-in-the-loop
paradigms.

#### 1.2 Which primitive — `ScheduleWakeup` vs. `scheduled-tasks`/cron

Two re-entry mechanisms, chosen by the **expected gap length**:

| Gap | Primitive | Use |
|---|---|---|
| **Short, in-loop self-pacing** (waiting on a background task, a peak-window that ends in minutes/hours, a soft pause expected to clear soon) | **`ScheduleWakeup`** — the in-session self-re-entry primitive | The master is conceptually "still in the run"; it parks and re-enters the same logical session to continue. Lowest overhead; no cron registration. |
| **Long gap** (budget `reset-period` rolls tomorrow; off-peak window opens tonight; a daily custodian cadence) | **`scheduled-tasks` / cron** (`scheduled-tasks` MCP create/list/update, or `CronCreate`) | The master registers a future scheduled run keyed to the reset/off-peak moment. The woken run is a fresh session that re-establishes context from the checkpoint. |

The master picks the primitive by reasoning about *when* the outstanding work
can next proceed:

- **Compose with cost-governance §D (peak-hour).** If a peak window blocks
  dispatch, the wakeup targets the **end of the blocking window** (§D.2's
  "next allowed start").
- **Compose with cost-governance §B/§E (budget reset).** If the budget proxy
  crossed `pause-and-report`, the wakeup targets the declared **`reset-period`**
  boundary (§E.2) — *not* a guessed provider cap reset (§E.1: the real cap/reset
  cadence is not reliably introspectable in-run).
- If both apply, the wakeup targets the **later** of the two (don't wake into a
  still-blocked window or a not-yet-reset budget).

#### 1.3 On-wake behaviour — re-read the checkpoint, continue

When a scheduled wakeup fires, the woken master session:

1. **Re-reads the §5 ledger checkpoint** in `docs/release-planning-v{X.Y}.md`
   (cost-governance §E.2: which items landed, which are in-flight, which
   deferred; the recorded branch tips; the deferred-work queue) — plus, if
   present, `.claude/cache/cost-checkpoint.json`.
2. **Re-validates the schedule** — the window or reset may have shifted (§D.2
   step 4); if still blocked, re-defer (schedule the next wakeup) and exit.
3. **Re-establishes release context** from the checkpoint and **continues the
   release from the recorded point** — resumes the normal Noir pipeline
   (`grm-release-phase` → `grm-release-agent-tracker` → `grm-release-phase-merge`).

This is the feasible, robust resume cost-governance §E.2 described: *checkpoint
to a known-good release state, then rely on scheduled re-entry* — not
in-flight-generation pause/resume.

#### 1.4 Push stays human-gated even when a wakeup resumes the run

**Critical invariant.** A scheduled wakeup resuming a Noir run does **not** lift
the push gate. When the resumed master reaches a push-ready point
(`grm-project-release` produced `dev` + `main` + tag), it still hits the normal
stop condition (`integration-master-SKILL.md` §Stop conditions #3) and **stops,
proposing the push and waiting**. The wakeup engine moves *work*, never the
*landing gate*. The only thing that lifts the push gate is the **explicit
opt-in `autonomous-push` config of §2** — which is independent of the wakeup
engine and off by default.

#### 1.5 Exactly what changes in the Noir paradigm content

The change lands in `claude-code/.claude/paradigms/noir/integration-master-SKILL.md`
(phase-2; specified here):

- **New section "§ Default wakeup — self-scheduled resume (v1.16)"**, placed
  after the existing v1.15 "§ Token-limit awareness — checkpoint and resume".
  It states the §1.1 rule (the three "work outstanding" triggers → schedule own
  resume), the §1.2 primitive-selection table, and the §1.3 on-wake re-read →
  continue loop. It explicitly composes with the §1.4 invariant.
- **Stop-conditions table augmentation.** The existing stop conditions (#3 push,
  #4 user stop, #5 milestone) stay. The change clarifies that conditions which
  today mean "report and wait for the human" now mean, *under Noir with work
  outstanding*, "checkpoint and **schedule a wakeup**" — **except** the push
  condition (#3), which remains a hard human-gated stop unless §2's flag is set.
- **One-line cross-reference** to this doc and to cost-governance §D/§E/§G so the
  wakeup behaviour is discoverable from the paradigm file.
- **No change** to the Supervised or Weiss paradigm content — their pause =
  human-driven resumption contract is untouched. The auto-wakeup section lives
  only in the `noir/` content set (which is the only set installed when the
  project is Noir; the others are never loaded — [work-paradigm-design.md](work-paradigm-design.md)).

### 2. Autonomous-push config (#16) — conservative, opt-in unattended landing

#### 2.1 The flag

A new **optional** block in `.claude/grimoire-config.json`:

```jsonc
{
  // ... existing config ...
  "autonomous-push": {
    "enabled": false          // default; absent ⇒ treated as false
  }
}
```

- **Additive at the current schema-version — no bump, no forced migration.** A
  config without the block behaves exactly as today (human-gated). The resolver
  reads the field live (consistent with the dials / cost-governance block).
- **Default and absent-config behaviour are identical and unchanged:**
  human-gated push. A project must *deliberately* add `"enabled": true` to lift
  the gate.

#### 2.2 How `push-guard.sh` consults it

`push-guard.sh` (`PreToolUse` Bash hook) today denies every push unless **(a)**
the worktree carries `.claude/integration-allow.local` (the blessed integration
marker) **and (b)** every pushed ref is on the allowlist (default `main`, `dev`,
version tags). Even with both, it *denies destructive/broad flags*. The flag
adds a **single additional gate that must be affirmatively open** — it never
*loosens* the existing checks:

1. The hook continues to require the **integration marker** (unchanged — see
   rail A below). No marker ⇒ deny, exactly as today. Task-agent worktrees still
   never push.
2. With the marker present and the ref/flag checks passing, the hook reads
   `autonomous-push.enabled` from `$CLAUDE_PROJECT_DIR/.claude/grimoire-config.json`:
   - `true` (explicitly) ⇒ allow the push (subject to all the existing
     ref-allowlist and denied-flag checks, which are **not** relaxed).
   - `false`, **absent**, missing file, or malformed/unreadable ⇒ **deny**
     (fail-closed) with the existing human-gate message. The agent is told to
     have a human push, or to enable the flag deliberately.
3. The destructive/broad-flag denials (`--force`, `--all`, `--mirror`,
   `--delete`, `--prune`, remote-ref deletion) **still deny even with the flag
   enabled.** Autonomous push covers ordinary `dev`/`main`/tag pushes only —
   never a destructive one.

This is a **clean addition** to the existing fail-closed structure: the hook's
default exit path stays "deny pushes," and the flag is the one explicit,
project-authored switch that opens the ordinary-push path.

#### 2.3 Safety rails (this is the framework's one human gate — be conservative)

- **Rail A — the marker is STILL required.** The flag does not replace the
  integration marker; it is layered *on top* of it. A non-blessed worktree
  cannot push regardless of the flag. (Marker AND flag, never marker OR flag.)
- **Rail B — explicit project config only; never inferred.** Nothing may set
  `autonomous-push.enabled = true` implicitly — not onboarding defaults, not a
  paradigm switch, not the Steady Steward preset write, not a model/effort
  profile. It is only ever `true` because a human typed it into
  `grimoire-config.json` (or a skill the human explicitly invoked to set it).
  Onboarding and the Steady Steward preset MUST leave it `false`/absent.
- **Rail C — fail-closed everywhere.** Absent block, unreadable file, malformed
  JSON, value other than the literal `true` ⇒ deny. The unattended path opens
  *only* on an unambiguous explicit `true`.
- **Rail D — destructive flags never autonomous.** §2.2 step 3 — broad/force
  pushes always require a human.
- **Rail E — documented risk.** The config docs and the flag's surrounding
  comment must state plainly: enabling this lets an unattended Noir run push to
  `origin` with no human at the keyboard; it should be enabled **only
  deliberately**, on a project whose owner accepts unattended landing, and is
  the single largest reduction in the framework's safety posture. Recommended
  pairing: a low daily budget (cost-governance §B) and `dev`-only landing if the
  project wants to keep `main` human-gated (achievable by an allowlist that
  omits `main`).

#### 2.4 Interaction with the wakeup engine and the paradigm push-stop

When `autonomous-push.enabled = true`, the Noir stop-condition #3 (push) changes
from a *hard stop* to a *proceed*: the resumed/continuing master may run the
single `dev` + `main` + tag push itself. When the flag is `false`/absent
(default), #3 remains a hard human-gated stop even under a wakeup-resumed run
(§1.4). The paradigm content (§1.5) references this flag as the *only* lever
that converts the push stop into a proceed.

### 3. Daily Routines research (#11) — the `schedule` skill as an automation channel

**Findings section feeding a future automation release. Not a v1.16 build.**

The `schedule` skill creates/updates/lists/runs **scheduled remote agents
(routines)** that execute on a cron schedule (one-time or recurring), backed by
the `scheduled-tasks` MCP primitive (and the `CronCreate`/`CronList` family).
Each scheduled run launches a Claude Code agent in the cloud/remote runner.

#### 3.1 Do scheduled routines cost tokens? — **Yes.**

Reasoning, not assumption: a scheduled routine **is a Claude Code agent run** —
it spins up a session, loads context, calls tools, and emits output, exactly
like an interactive or `spawn_task` session. Every message in that run carries
the same `usage` token classes (`input`, `output`, `cache_read`,
`cache_creation`) that the `grm-token-measure` skill reads from `.jsonl`
transcripts (cost-governance §E.1). **There is no free scheduled tier** — the
agent thinks, therefore it bills. The relevant nuances:

- **Where they run:** on the remote/cloud runner (not the user's interactive
  terminal), but on the **same account**, so their tokens draw against the
  **same budget/quota** as interactive work. They are *not* outside the
  cost-governance §B budget; a scheduled routine should be counted against it.
- **Cache behaviour is worse for cron than for an interactive loop.** Each
  scheduled run is typically a cold session — it cannot rely on a warm prompt
  cache the way a long interactive session can, so its cache-read fraction is
  lower and its effective cost-per-task is *higher* than the same work folded
  into an already-warm session. This argues for **batching** cadence work (one
  routine that does several checks) over many tiny separate routines.
- **Implication for cost-governance:** scheduled routines are exactly the
  autonomous/scheduled dispatch path that §D (peak-hour defer) and §B (budget)
  were written to govern. A routine that would fire inside a blocked peak window
  should defer (§D.2); a routine's tokens count toward the daily budget.

**Verdict: scheduled routines cost tokens (same account/budget, run remotely,
with a *worse* cache profile than warm interactive work). Treat them as
budgeted autonomous dispatch, prefer batched routines over many small ones, and
gate them through cost-governance §B/§D. They are worth it only where the
recurring value clearly exceeds the cold-session token cost.**

#### 3.2 Ranked shortlist of viable daily-cadence uses

Ranked by value-per-token (recurring signal worth the cold-session cost) and
safety (read-mostly first; anything that writes/commits must respect the push
gate and §2):

1. **Stale-branch / dead-worktree cleanup.** High value, low token cost, mostly
   read + cheap git ops. A daily sweep that lists merged-but-undeleted
   `version/*` branches and dead worktrees (per `docs/integration-workflow.md`
   §Dead-worktree cleanup) and reports them — or, under Noir, removes
   verified-merged-clean ones. Bounded blast radius; a natural custodian chore.
2. **Dependency / security freshness.** Daily check for new dependency releases
   and known-vuln advisories against the lockfile; file findings via the
   Reporter → issue tracker. Read-only + one tracker write; high signal, very
   bounded cost.
3. **Scheduled code-review of recent changes.** A daily reviewer pass over the
   last day's merges to `dev` (wrapping the `code-review`/Reviewer path),
   filing non-blocking findings to the tracker. Token cost scales with diff
   size — cap it to "changes since yesterday" to keep it cheap.
4. **Design-doc / golden drift detection.** Daily diff of live skills/hooks
   vs. the `grm-workflow-bootstrap` golden baseline and of design docs vs. the
   features they describe (cf. `grm-install-doctor`'s DRIFTED audit). Reports drift
   as issues; read-only; cheap and high-leverage for a dogfooding repo.
5. **Backlog grooming via Triager / Reporter.** A periodic (weekly more than
   daily) grooming pass — dedupe, label, prioritize, close stale items — driven
   by the Triager role (`agent-roles-design.md`). Lower daily urgency; batch it
   to amortize the cold-session cost.

Common rails for all five: run under Noir as budgeted dispatch; prefer
read/report over write; any write/commit obeys the push gate (§2 default =
human-gated); batch related checks into one routine to recover cache value.

### 4. Worktree-isolation overhead research (#17)

**Question.** Should the **Careful-Serial** workflow variant
(`write-capable-workflow-design.md`: `maxConcurrency: 1`, agents run one at a
time) **skip** per-agent isolated worktrees for **trivial single-file edits** and
operate directly on the staging branch (`version/{X.Y}`), to avoid the
worktree setup + disk overhead?

#### 4.1 The trade-off

- **What isolation costs:** each isolated worktree is a `git worktree add` (disk
  copy of the working tree), a short-lived branch, setup/teardown, and the
  per-agent overhead the S1 spike measured (`execution-profiles-design.md`). For
  a one-file, few-line edit this overhead can rival or exceed the edit itself.
- **What isolation buys:** **collision avoidance** (two agents can't touch the
  same tree) and **bounded blast radius** (a bad edit is confined to a throwaway
  branch the master reviews before merging). Under Careful-Serial, the
  *concurrent-collision* risk is **already eliminated by construction** —
  `maxConcurrency: 1` means no two agents run at once, so the main thing
  isolation protects against (parallel writes to one tree) cannot occur.
- **The residual risk of operating on staging directly:** even serial, a
  direct-on-`version/{X.Y}` edit (a) loses the per-agent review-before-merge
  gate (the change is *already on staging*, not on a branch the master vets),
  and (b) widens blast radius — a bad or half-finished edit dirties the shared
  staging branch instead of a disposable worktree, and an interrupted agent
  leaves staging in an uncertain state.

#### 4.2 Recommendation

**Keep isolated worktrees as the default even for Careful-Serial; do NOT
operate directly on the staging branch.** The collision argument for skipping
isolation is real *only* for the concurrency dimension, which Careful-Serial
already neutralizes — but isolation's *second* job (the review/blast-radius gate
and clean interruption semantics) still matters serially, and that is the more
valuable of the two for an unattended Noir run. The setup/disk overhead is a
**one-file-edit-scale** cost; the safety it buys is **release-branch-integrity-
scale**. The trade is not worth taking by default.

**Narrow, opt-in exception (recommended as the actionable seam, not the
default):** allow a *trivial-edit fast path* that skips the worktree **only**
when ALL hold: (a) variant is Careful-Serial (serial — no concurrent
collision); (b) the change is a single file, few lines, declared trivial by the
workflow; (c) the master commits each such edit **atomically on a short-lived
branch off staging in its own marker-blessed worktree** (so the review/merge
gate and `protected-branch-guard.sh` are preserved) rather than dirtying
`version/{X.Y}` in place. In other words: the *fast path* may cheapen worktree
*creation* (reuse the master's worktree for a quick branch+commit), but it must
**not** abandon the per-change branch + review gate. Editing the shared staging
branch directly is rejected.

This recommendation **feeds the workflow-variant design**
(`write-capable-workflow-design.md`): if implemented, it becomes a documented
Careful-Serial sub-option (`isolation: 'reuse-branch'` for trivial edits),
defaulting to full per-agent worktrees.

### 5. How this completes the Steady Steward preset

`cost-governance-design.md` §G.3 listed three building blocks the Steady Steward
preset needs and v1.15 did not ship:

| Block | Supplied by |
|---|---|
| **#13 default Noir wakeup** (the cadence engine — recurring scheduled re-entry between checkpoints) | **§1** of this doc (the default-on wakeup rule + primitive selection + on-wake ledger re-read, composing with cost-governance §D/§E) |
| **#16 autonomous push** (the unattended landing) | **§2** of this doc (the opt-in `autonomous-push` flag + `push-guard.sh` consult + conservative rails) |
| **#11 Daily Routines** (the scheduling channel the cadence can ride) | **§3** research — establishes the `schedule`/`scheduled-tasks` channel, its cost profile, and viable uses |

With the §1 cadence engine driving the one-item-per-wake loop (cost-governance
§G.2), the §E checkpoint persisting state across sleeps, and the §2 flag
optionally letting the landed item reach origin, the Steady Steward
(`Noir × Cheap-Slow × Eco + low daily budget + terse + off-peak +
one-item-per-wake`) becomes a configuration that **runs unattended end-to-end**
— scope one safe item, land it, checkpoint, schedule the next wake, sleep —
while the §2.3 rails keep the push gate closed unless a human deliberately
opens it.

## Acceptance

- [ ] Design doc at `claude-code/docs/design/autonomy-scheduling-design.md` in
      the house layout; indexed in `claude-code/docs/design/README.md`.
- [ ] **Default Noir wakeup (#13):** the rule is specified — the three
      "work-outstanding" triggers, `ScheduleWakeup` (in-loop) vs.
      `scheduled-tasks`/cron (long gap) selection composing with cost-governance
      §D/§E, the on-wake §5-ledger-checkpoint re-read → continue loop, and the
      exact Noir-paradigm-content change. Supervised/Weiss explicitly keep
      human-driven resumption (no auto-wakeup).
- [ ] **Push stays human-gated under a wakeup-resumed run** is stated as an
      invariant (§1.4); only §2's flag converts the push stop to a proceed.
- [ ] **Autonomous-push config (#16):** schema (`autonomous-push.enabled`,
      default `false`, additive/no schema bump); how `push-guard.sh` consults it
      (marker AND flag; ref-allowlist and denied-flag checks not relaxed); rails
      A–E (marker still required; explicit-config-only never inferred;
      fail-closed; destructive flags never autonomous; documented risk).
- [ ] **Daily Routines research (#11):** findings section answering (1) do
      scheduled routines cost tokens — yes, with reasoning (same account/budget,
      remote runner, worse cache profile) — and (2) a ranked shortlist of viable
      daily-cadence uses, feeding a future automation release.
- [ ] **Worktree-isolation overhead research (#17):** a recommendation
      (keep isolation as default even for Careful-Serial; narrow opt-in
      trivial-edit fast path that preserves the branch+review gate; reject
      editing staging directly) feeding the workflow-variant design.
- [ ] **Steady Steward completion** (§5) is shown explicitly: #13 + #16 (+ #11
      channel) are mapped to the §1/§2/§3 deliverables.
- [ ] Cross-links present: cost-governance, execution-profiles,
      write-capable-workflow, agent-roles.

## Open questions

- **Wakeup primitive availability/naming.** This doc names `ScheduleWakeup`
  (in-loop self-pacing) and `scheduled-tasks`/`CronCreate` (long-gap cron) per
  the available primitives. The phase-2 agent should confirm the exact in-loop
  self-re-entry primitive name/semantics in the target harness and adjust §1.2
  if the in-loop primitive differs; the design (gap-length → primitive) holds
  regardless.
- **`main`-gated-but-`dev`-autonomous landing.** §2.3 Rail E suggests a project
  could allow autonomous `dev` push while keeping `main` human-gated via an
  allowlist that omits `main`. Phase-2 should confirm the allowlist composes
  cleanly with the flag and document the recommended posture.

## Follow-ups

- **Phase-2 — Noir paradigm wakeup section:** add the §1.5 "Default wakeup"
  section to `noir/integration-master-SKILL.md` + the stop-conditions
  clarification; leave Supervised/Weiss untouched.
- **Phase-2 — `autonomous-push` config + `push-guard.sh` consult:** implement
  §2.2's flag read (fail-closed) in `push-guard.sh`, document the block + risk
  in the config schema docs, and ensure onboarding / Steady Steward preset leave
  it `false`.
- **Phase-2 — Steady Steward wiring:** connect the §G.1 preset to the §1 cadence
  engine and (opt-in) the §2 flag so the preset runs unattended.
- **Future automation release — scheduled routines:** build the §3.2 shortlist
  routines (stale-branch/dead-worktree cleanup first), each as budgeted,
  batched, peak-aware dispatch (cost-governance §B/§D), respecting the push gate.
- **Workflow-variant design — trivial-edit fast path:** if adopted, add the §4.2
  `isolation: 'reuse-branch'` Careful-Serial sub-option to
  `write-capable-workflow-design.md`, defaulting to full isolation.
- **`copilot/` port:** mirror only the `autonomous-push` config-schema
  documentation (no scheduling/wakeup equivalent exists for Copilot), after
  `claude-code/` canonical lands.
