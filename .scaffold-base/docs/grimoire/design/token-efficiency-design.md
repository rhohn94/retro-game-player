# Token Efficiency

> **Up:** [↑ Design docs](README.md)


> Methodology foundation for the v1.9 "Token Efficiency" release. E2–E6 build
> on this doc: E2 implements the measurement protocol; E3–E6 apply the ranked
> cost levers to concrete scaffolding surfaces. This doc owns the *model* and
> the *evidence rules*, not the individual optimizations.

## Motivation

The v1.4 release-planning Workflow produced a concrete, measured cost model —
four A/B datapoints showing ~88% cost reduction from model-tiering, batched
sizing, and read-trimming (see
[`release-planning-workflow-design.md`](release-planning-workflow-design.md)
§Agent-tiering / cost model). That model is correct but *local*: it was derived
for, and scoped to, one Workflow's read-fan-out. The same mechanics — output is
expensive, cache reads are cheap, model tier multiplies everything — govern
*every* agent the scaffolding spawns: task agents in worktrees, the integration
master's session, helper `Agent`s, and skills that read large preambles on every
invocation.

This doc generalizes the v1.4 model into a **scaffolding-wide, evidence-first
efficiency methodology**. It states the pricing mechanics the optimizations
exploit, ranks the cost levers by ROI so downstream items optimize the highest
-value surfaces first, and defines a measurement protocol so every claimed saving
is backed by before/after token counts rather than intuition. The intent is that
E3–E6 cite *this* model when they justify a change, and that future releases
extend the same ranked-lever framing instead of re-deriving it per feature.

What changes if we don't ship it: optimizations land ad hoc, justified by the
naive "shrink the boilerplate" instinct, which (see §Cost levers, lever 4) is
often the *lowest*-value lever and occasionally a net loss. Without a measurement
protocol, we cannot tell a real saving from a wash.

## Scope

**In scope:**
- The Anthropic pricing mechanics the scaffolding's optimizations exploit
  (token classes, relative cost ordering, prompt-cache behavior, model-tier
  multipliers).
- A ranked list of cost levers with the rationale for the ranking, applicable
  across every agent the scaffolding spawns — not just Workflows.
- A measurement protocol (the contract E2 implements): what a valid A/B is, how
  token counts are captured, the report shape, and the break-even framing.
- Generalizing — not replacing — the v1.4 release-planning cost model. The v1.4
  numbers remain the worked example; this doc is the reusable frame around them.

**Out of scope / non-goals:**
- **New features.** This release is efficiency-only. No new skills, workflows, or
  user-facing capabilities are introduced under the E-series beyond the
  measurement tooling E2 needs.
- **Behaviour change beyond efficiency.** An optimization that changes *what* an
  agent produces (not just how cheaply) is out of scope; correctness and output
  quality must be preserved. "Same result, fewer tokens" is the bar.
- **Exact dollar rates.** Published per-token prices change; this doc fixes the
  *relative-cost ordering* and the *tier multipliers* (which are stable enough to
  plan against), not absolute rates.
- **Per-surface implementation detail.** E3–E6 own the concrete edits and their
  own measurements; this doc is the shared methodology they cite.

## Design

### Anthropic pricing mechanics (load-bearing)

Every optimization in this release is an exploitation of one of the following
facts. Getting the *ordering* right matters more than any absolute number.

#### Token classes, cheapest → most expensive

A single API call bills four distinct token classes at different rates. From
cheapest to most expensive per token:

1. **Cache-read (warm) tokens** — context already in the prompt cache, re-sent
   with a matching stable prefix. The cheapest class by a wide margin. The
   per-agent fixed context (system prompt + tool schemas, ~45K tokens — see
   below) is paid at this rate on every turn *after* the first, provided the
   prefix stays stable.
2. **Input (cold) tokens** — ordinary uncached input. The baseline rate.
3. **Cache-creation (cold write) tokens** — input written *into* the cache for
   the first time. Costs a **premium over plain input** (you pay extra to seed
   the cache, betting the seed will be re-read warm before the TTL expires).
4. **Output (generated) tokens** — the most expensive class, and
   **disproportionately so on Opus**. Generation dominates marginal cost; a few
   thousand generated tokens can outweigh tens of thousands of warm reads.

The single most important consequence: **favor warm cache reads; minimize
generated output, especially on Opus.** Reading is cheap; writing is expensive;
generating is the most expensive thing an agent does.

#### Prompt-cache behavior

- **~5-minute TTL.** A cached prefix stays warm for roughly five minutes after
  its last use. Work that pauses longer pays cold/creation rates again on resume.
- **Stable-prefix requirement.** A cache hit requires the prompt prefix to match
  byte-for-byte up to the cache breakpoint. Any change *near the front* of the
  context — an edited system prompt, a reordered tool schema, a freshly injected
  preamble — invalidates the entire warm suffix behind it. The cost of a
  front-of-context edit is therefore not the edit's own size but the loss of
  every warm token after it.
- **Drip-reading churns the cache.** Reading files incrementally across many
  turns (read a bit, act, read more) repeatedly reshapes the tail of the context,
  forcing re-creation of cache segments. Reading a file once, in a single step,
  keeps the cached region stable and is markedly cheaper than the same bytes read
  across several turns. This is the mechanism behind v1.4's "single-step reads"
  trim.

#### Model-tier multipliers

From the v1.4 model (see
[`release-planning-workflow-design.md`](release-planning-workflow-design.md)
§Finding 1), the stable per-token multipliers are:

- **Opus ≈ 5× Sonnet** per token.
- **Sonnet ≈ 3× Haiku** per token.
- Therefore **Opus ≈ 15× Haiku** per token.

These ratios are robust across runs even as absolute rates drift, so they are
safe to plan against.

The crucial volume observation, also from v1.4: **the per-agent fixed context
dominates token volume.** System prompt + tool schemas are ~45K tokens per agent
on entry; each agent's own *output* is small by comparison (~1K for a mechanical
reader). Token *volume* is therefore nearly flat across model tiers — the same
agent reading the same files emits roughly the same token counts regardless of
model. What changes is the *rate*. This is why model tiering (lever 3) is a large
multiplier on mechanical work, and why output minimization (lever 1) is the top
lever: output is the one volume an agent fully controls, and it is the most
expensive class on the most expensive model.

### Cost levers, ranked by ROI

Levers are ranked by return on the effort of applying them. Downstream items
(E3–E6) should exhaust higher levers before reaching for lower ones, and must
justify any lever-4 work with measurement (see §Measurement protocol).

#### Lever 1 — Output-token minimization (highest ROI; worst on Opus)

Output is the most expensive token class and the only volume an agent fully
controls. On Opus it is ~15× the Haiku rate per token, so a verbose Opus agent is
the worst case in the entire cost surface. Tactics, in rough order of impact:

- **Diffs over full-file rewrites.** Emitting a small edit/patch instead of
  regenerating an entire file is often a 10–100× output reduction on edit-heavy
  work. This is the single highest-impact output tactic.
- **Terse, structured output.** Return the minimum that conveys the result.
  Tables and short bullet lists over prose; no restating of inputs; no
  recapping of files merely read.
- **Output schemas.** Constraining an agent to a validated JSON/structured
  result (the `agent()` `schema` option) caps generation and removes free-text
  padding — the synthesis consumer gets clean data instead of parsed prose.
- **Tier *down* output-heavy steps.** A step that unavoidably generates a lot of
  output is the best candidate to move off Opus onto Sonnet/Haiku — output is
  exactly where the tier multiplier bites hardest.

#### Lever 2 — Cache-hit maximization / churn reduction

Warm reads are the cheapest class; the goal is to keep as much context warm as
possible and avoid invalidating it.

- **Stable prefixes.** Treat the front of the context (system prompt, tool
  schemas, long-lived preambles) as immutable during a working session. Avoid
  edits or injections near the front mid-session; they invalidate the entire
  warm suffix behind them.
- **Single-step reads.** Read each needed file once, fully, rather than dripping
  it across turns. Fewer turns reshaping the tail means fewer cache
  re-creations. (Directly the v1.4 trim.)
- **Respect the ~5-min TTL.** Batch related work so cache-warm context is reused
  inside the TTL window rather than re-seeded cold after a long pause.

#### Lever 3 — Model tiering (right-size model per task)

Because token volume is nearly flat across tiers but the rate is not, moving a
*mechanical* agent (extraction, lookup, classification with no judgement) from
Opus to Haiku cuts its cost ~15× with no quality loss. Reserve Opus for genuine
judgement and user-facing synthesis. The v1.4 phase→model table
([`release-planning-workflow-design.md`](release-planning-workflow-design.md)
§Finding 1) is the worked template: Haiku for mechanical readers, Sonnet for
light-judgement classification/sizing, session model only for the final
deliverable. Note the constraint from v1.4: inside a Workflow, `agent()` exposes
`model` but **not** `effort`; model tier is the only in-script knob, and
effort-level tuning must happen at the user/session level.

#### Lever 4 — Fixed-context / preamble trim (LOWEST; data-gated)

The naive instinct on seeing a 45K fixed context is "shrink the boilerplate."
**This is the lowest-value lever and is frequently a wash, because the fixed
context is paid at the cheap warm cache-read rate on every turn after the first.**
Trimming warm tokens saves a small amount per turn; the effort rarely pays back.

This lever is **data-gated**: do not trim a preamble, system prompt, or tool
schema on the assumption it saves money. It is only worthwhile for files that are
**high-frequency *and* cold-read-dominated** — read fresh (cold/creation rate) on
many short-lived agents that never get the warm-read benefit, e.g. a large
preamble loaded once per spawned task agent across hundreds of one-shot spawns.
For such files, the saving is real and compounds. For a file that lives in a
stable, cache-warm prefix, trimming it is close to free money that isn't there.

> **Counter-intuition (call this out explicitly):** shrinking boilerplate is the
> *last* lever, not the first. A change that visibly makes a file smaller can
> save nothing if that file was warm; a change that emits a diff instead of a
> rewrite (lever 1) saves far more while touching no preamble at all. E3–E6 must
> not reach for lever 4 without a cold-read-frequency measurement showing the
> file is in the worthwhile class.

### How the levers interact

The levers are roughly multiplicative, not additive, and they are correctly
ordered by where the cost actually concentrates: an expensive class (output) on
an expensive model (Opus) generated repeatedly is the worst case, and levers 1+3
attack exactly that intersection. Lever 2 protects the cheap-by-default volume
from being made expensive through churn. Lever 4 chases the residue. Optimize in
rank order.

### Cache-aware authoring (lever 2, applied to scaffolding files)

This subsection turns lever 2's mechanics (§Prompt-cache behavior) into durable
rules for authoring the scaffolding's own instruction files and for how agents
read them. The goal is to keep the high-volume warm-read class *warm* — a cache
miss or a churned prefix silently demotes cheap reads into the expensive
cache-creation/cold-input classes (the baseline confirms cache_read dominates
volume; the win is keeping that volume in the cheap class, not shrinking it —
shrinking is lever 4, the lowest lever).

**For agents reading files (single-step reads).** The cache tail is reshaped
every time a turn adds new read output behind the warm prefix; doing that across
many turns re-creates the same bytes repeatedly. So:

- **Read a predictable, named set in one step.** When the files you need are
  already known — a task lists its design docs, `grm-repo-reference` gives a fixed
  doc-location table, a skill names its inputs — read them all in a single
  batched step. Do not read one, act, read the next.
- **Don't interleave reads with cache-invalidating edits.** Front-load the
  reading you can predict, *then* edit. Alternating read→edit→read churns worse
  than either phase alone, because each edit near the front of the context drops
  the warm suffix that the next read then has to re-create.
- **This targets *predictable* read sets, not discovery.** Exploratory reads
  that genuinely depend on what an earlier read revealed are correct and stay.
  The waste being removed is drip-reading a set you already knew up front.

**For authors editing high-frequency instruction files (stable prefixes).**
`CLAUDE.md` and other always-loaded preambles sit at the *front* of every
agent's context — exactly the cache-prefix region where an edit is most
expensive, because it invalidates the entire warm suffix behind it for every
agent that loads the file afterward. Therefore:

- **Front-load the most stable content; keep volatile content later.** Order an
  always-loaded file so its long-lived, rarely-touched sections come first and
  anything edited often (or filled in per-project) comes after. A churning
  section near the top costs more than the same churn lower down.
- **Treat front-of-context edits as expensive even when small.** The cost of a
  front edit is not its own byte count but the warm tokens it strips behind it.
  Batch instruction-file edits rather than dribbling them across a session, and
  prefer appending to a stable tail over reordering a stable head.
- **Semantics outrank cache-friendliness.** A reordering is only worth doing
  when it does not change instruction *meaning* and the stability win is clear.
  If a cache-friendly reorder would risk altering behaviour, document the
  recommendation instead of making it. This is an efficiency pass, never a
  behaviour change (per §Scope non-goals).

**Why this is defensible without a clean A/B (qualitative argument).** The
mechanics force the direction even without an isolated measurement: a warm read
is the cheapest class and a cache-creation token carries a premium over plain
input (§Token classes), so every avoided prefix-invalidation converts
would-be cache-creation/cold tokens back into warm reads — a strict cost
decrease for the affected volume, which the baseline shows is the dominant
volume. The size of the win scales with the file's load frequency: `CLAUDE.md`
loads on *every* turn of *every* agent, so a single stabilizing decision there
compounds across the whole spawn fan-out, while the same care on a rarely-loaded
file barely matters. A precise per-operation A/B (single-step vs. drip read of
the same set) can be captured with `grm-token-measure` per the protocol below;
pending that, the inequality "warm < creation" is sufficient to justify the
authoring rules, and none of them trade away correctness to bank the saving.

## Measurement protocol (what E2 implements)

No saving is accepted on intuition. Every optimization lands with a before/after
measurement under this protocol. E2 builds the tooling that produces these
numbers; this section is the contract it satisfies.

### What a valid A/B comparison is

- **Same operation, same inputs.** Before and after must run the identical task
  on identical inputs (same files, same prompt intent, same model unless the
  change *is* a tier change). Comparing two different prompts is not an A/B.
- **Same result.** The "after" must produce a functionally equivalent result —
  efficiency only (per §Scope non-goals). A saving that degrades the output is
  not a saving; record it as a regression.
- **Isolate one lever per comparison** where possible, so the attribution is
  unambiguous. When levers are bundled, say so and do not attribute the total to
  any single lever.
- **Account for cache state.** A warm-cache run and a cold-cache run of the same
  operation differ enormously. Record which was measured; prefer reporting both,
  or explicitly note the cache state of each side.

### Capturing token counts

- **Primary method — parse session/agent `.jsonl` `usage` fields.** Each
  recorded turn carries a `usage` object; sum the four classes across the
  operation's turns:
  - `input` — cold input tokens
  - `output` — generated tokens
  - `cache_read` — warm cache-read tokens
  - `cache_creation` — cold-write-to-cache tokens
  This is the authoritative method because it resolves all four classes
  separately, which is exactly the granularity the cost model needs (output and
  cache-creation cost differently from input and cache-read).
- **Fallback method — the Workflow `budget.spent()` API.** Available inside a
  Workflow script, but **weaker**: it is effectively output-oriented and does not
  break results down by the four classes. Use it only when `.jsonl` usage is
  unavailable, and flag any number sourced from it as output-only/approximate.

### Report shape

A measurement reports a **table of token classes per operation**, before vs.
after, plus the derived deltas. The canonical shape:

| Operation | Variant | input | output | cache_read | cache_creation | est. cost | Δ vs. before |
|---|---|---|---|---|---|---|---|
| {op name} | before | … | … | … | … | … | baseline |
| {op name} | after | … | … | … | … | … | −NN% |

`est. cost` is derived by weighting each class by its rate using the tier
multipliers (§Model-tier multipliers); exact dollars are not required, and the
report should state that the cost column is a relative estimate. The four raw
class counts are the load-bearing data — the cost column is a convenience
roll-up.

### Break-even / payback framing

Optimizing costs tokens too (the agent doing the optimization generates output,
reads files). An optimization is justified only if it pays back. Frame every
proposed change as **spend now to save later**:

- Estimate the **one-time cost** of applying the optimization (the tokens to
  design + implement + measure it).
- Estimate the **per-invocation saving** (the before/after delta).
- Compute the **break-even count** = one-time cost ÷ per-invocation saving =
  roughly how many future invocations of the operation amortize the spend.
- Prefer optimizations on **high-frequency** operations (low break-even count)
  and be skeptical of expensive optimizations on rarely-run operations (a
  break-even of hundreds of invocations on a once-a-release operation may never
  pay back).

**Recommended target metric:** report each optimization's reduction as a
**percent decrease in estimated cost for the operation**, and set a default
acceptance floor — an optimization should target **≥20% estimated-cost reduction
on its operation** to be worth landing, unless it is near-zero-cost to apply
(then any positive, measured saving is acceptable). E2 may refine this floor once
real `.jsonl`-sourced numbers are in hand.

## Acceptance

- [ ] `docs/design/token-efficiency-design.md` exists at the flat path and
      follows the house layout (Motivation, Scope, Design, Acceptance, Open
      questions, Follow-ups).
- [ ] `docs/design/README.md` indexes this doc.
- [ ] The token-class relative-cost ordering (cache_read < input < cache_creation
      < output; output worst on Opus) is stated explicitly and correctly.
- [ ] Prompt-cache behavior (≈5-min TTL, stable-prefix requirement, drip-read
      churn) is documented.
- [ ] The model-tier multipliers (Opus ≈ 5× Sonnet, Sonnet ≈ 3× Haiku, Opus ≈
      15× Haiku) and the fixed-context volume observation are captured and
      cross-linked to the v1.4 doc.
- [ ] The four cost levers are presented in priority order with the ranking
      rationale, and lever 4 explicitly carries the data-gated counter-intuition.
- [ ] The measurement protocol defines a valid A/B, the `.jsonl` `usage` primary
      method (input/output/cache_read/cache_creation) and the `budget.spent()`
      fallback, the per-operation token-class report table, and the
      break-even/payback framing with a recommended target reduction.
- [ ] Non-goals (no new features; no behaviour change beyond efficiency; no exact
      dollar rates) are stated.

## Open questions

- **Are `.jsonl` `usage` fields reliably available in this environment?** The
  measurement protocol assumes per-turn `usage` objects with `input` / `output` /
  `cache_read` / `cache_creation` can be read from session/agent transcript
  `.jsonl` files. If the fields are absent, partial, or differently named, the
  protocol falls back to the weaker output-only `budget.spent()` API and the
  per-class report shape degrades. **E2 resolves this** — confirm field
  availability and exact names, and adjust the protocol/report shape accordingly.

## Follow-ups

- **E2 — Measurement tooling.** Implement the capture + report tooling defined in
  §Measurement protocol; resolve the `.jsonl` open question.
- **E3–E6 — Apply the levers.** Each item optimizes a concrete scaffolding
  surface in lever-rank order, lands with a before/after measurement under this
  protocol, and cites the relevant lever here. Lever-4 work must include a
  cold-read-frequency justification.
- **Copilot-flavor port.** This doc is authored in root `docs/design/` only;
  porting the methodology to the `copilot/` flavor (where applicable — the
  `budget.spent()` fallback is Claude-Code-only) is a later step, not part of E1.
- **Refresh the v1.4 cross-reference** if the release-planning cost model is
  re-measured; keep the multipliers in this doc and
  [`release-planning-workflow-design.md`](release-planning-workflow-design.md)
  consistent.
