# S1 — Empirical spike: is slow solo-serial cheaper than parallel dispatch?

> **Up:** [↑ Docs](README.md)


> v1.11 "Execution profiles", Phase-1 gate. Drives the design of the
> **Cheap-Slow** posture. Method: parse EXISTING transcripts with
> `.claude/skills/grm-token-measure/parse_usage.py` (no big re-runs). All figures
> are the parser's **relative** cost roll-up (cache_read=0.08, input=1/3,
> cache_creation=1.25/3, output=1.0; × tier Opus=15/Sonnet=3/Haiku=1) — not
> dollars. Every number traces to a cited transcript or a stated assumption.

## Hypothesis

"Cheap = slow solo": a single serial session doing K items reuses one warm
cache and so costs less total than spawning K parallel agents that each pay a
cold preamble. **Refuted in the general case; true only in a narrow corner.**

## Measured inputs

### Parallel-dispatch fleet (20 real spawn_task work-item agents, v1.8–v1.10)

Each `spawn_task` agent lands in its own worktree project dir
`~/.claude/projects/-Users-roberthohn-Projects-agentic-scaffolding--claude-worktrees-<name>/*.jsonl`.
There is no `subagents/` dir for these — spawn_task agents are top-level
sessions in their own worktree dir. Measured via `parse_usage.py --session-only`:

| Cluster | n | median rel-cost | mean | range |
|---|---|---|---|---|
| Light (doc/mechanical, <300K) | 11 | 145,390 | 145,534 | 14,556 – 266,349 |
| Heavy (code + review, ≥300K) | 9 | 1,447,927 | 1,422,266 | 348,068 – 2,855,595 |
| All 20 | 20 | 237,689 | 720,063 | 14,556 – 2,855,595 |

Representative cited transcripts (worktree dir / file):
`hardcore-kowalevski-5d303c/4b7e44fd…` (light, 145,390),
`elastic-nobel-e22cec/7d85a15e…` (heavy W3 code-review, 1,416,706 — matches the
committed baseline row), `relaxed-chaplygin-cb3fde/9e855649…` (heaviest, 2,855,595).
Per-agent cold-seed (cache_creation) median in the light cluster: **26,963 tokens**.

### Solo-serial reference (long integration-master session)

`…--claude-worktrees-cranky-lovelace-576476/d7eb7d2c…jsonl` — the v1.11
integration-master session: **105 operations, 5,788 records, 8 `compact_boundary`
events**. `--session-only` total: output 1,448,159 / cache_read **197,973,332** /
cache_creation 4,918,604 / **rel-cost 292,151,918**.

- **Avg cost/op = 2,782,399** — ~19× the *entire* cost of a median light agent
  (145,390), ~2× a whole heavy agent.
- **Avg cache_read/op = 1,885,460** and climbing: per-op cache_read starts ~0.4–0.8M
  (ops 5–8) and reaches **4–8M** in later ops as the warm prefix grows.
- **Superlinearity, measured directly:** second-half cache_read sum (118.3M) is
  **1.48×** the first-half sum (79.7M) over 104 ops — the *same* unit of work gets
  more expensive the deeper into the session it runs.
- A second solo-ish session, `…-agentic-scaffolding/c8fe8b91…` (219 ops,
  rel-cost 35,537,091), shows the same shape at smaller scale.

## The two cost models

**Parallel** (K independent items): `K × (per_item + orch_increment)`. Flat in K
— each agent pays its own ~27K cold seed + ~45K warm fixed context, then its own
reads/writes; the orchestrator pays a roughly constant dispatch+merge increment
per item (estimated ORCH≈600K rel from low-context IM ops 5–8).

**Solo-serial** (K items, one growing context):
`Σ_{k=1..K} [ (BASE_CR + SLOPE·k)·0.08 + out·1.0 + cc·1.25/3 ]·15 + compactions`.
Calibrated to the cranky-lovelace curve: BASE_CR≈400K, SLOPE≈120K/item, one
~2M-rel compaction every ~13 items (8 over 105 ops). The `SLOPE·k` term makes
solo **quadratic** in K; parallel is **linear**.

### Crossover (modelled, calibrated to the measured curve)

| K | solo | parallel (light items) | parallel (heavy items) |
|---|---|---|---|
| 1 | 1,055,250 | 745,390 | 2,047,927 |
| 3 | 3,597,750 | 2,236,170 | 6,143,781 |
| 5 | 6,716,250 | 3,726,950 | 10,239,635 |
| 10 | 17,032,500 | 7,453,900 | 20,479,270 |
| 15 | 32,948,750 | 11,180,850 | 30,718,905 |
| 20 | 50,465,000 | 14,907,800 | 40,958,540 |
| 50 | 235,162,500 | 37,269,500 | 102,396,350 |

## Findings

1. **Solo NEVER beats parallel for light/mechanical items**, at any K. Even at
   K=1 a doc-sized item is cheaper as a spawn (745K vs 1.06M) because the solo
   session is already carrying a multi-MB warm prefix that it re-reads every turn,
   whereas a fresh light agent starts near-cold and cheap.

2. **Solo beats parallel only for HEAVY items at small K (≈ K ≤ 10–14).** In that
   corner solo wins by *not* paying N separate ~27K cold seeds + N fixed contexts
   for genuinely large work-units. The crossover is ~K=14 (32.9M solo vs 30.7M
   parallel-heavy). Past it, solo's quadratic growth loses decisively — at K=50
   solo is **2.3× more expensive** than parallel-heavy and **6.3×** vs parallel-light.

3. **The hypothesis is refuted as a general rule.** "Cheap = slow solo" holds
   only for *a few large items*, and even there the win is modest and fragile (it
   evaporates by ~K=14 and inverts hard after). The cited 6K cold preamble /
   per-agent seed (token-efficiency-baseline.md) is real but *small* relative to
   the growing-warm-prefix tax a long solo session pays.

## Recommendation — what "Cheap-Slow" should mechanically BE

Cheap-Slow is **not** "one literal solo session does everything." That is the
*most* expensive option at any realistic release K (the IM sessions are the
single costliest transcripts measured). Instead:

- **Default Cheap-Slow = low-fanout small batches + Eco model-profile + Haiku/Sonnet
  tiering.** This captures the real lever: parallel cost is dominated by *per-item
  model tier* (lever 3) and *output* (lever 1), not by fan-out width. A batch of
  Haiku/Sonnet mechanical agents at ~145K each crushes both a solo Opus session
  and a wide Opus fan-out. Keep batches small to bound peak orchestrator context,
  but keep the work *parallel and tiered down*.
- **In-session subagents (deferred N1) for a SHORT run of tiny related items.**
  When K is small and items are tiny/dependent, in-session subagents avoid K cold
  seeds without inheriting the solo session's giant prefix — they win the K≤~10
  corner more cleanly than a literal solo session does. This is the right home for
  the "few large items" corner from finding 2.
- **Literal solo-serial: only for K ≤ ~3 dependent items**, or where parallelism
  is impossible (hard sequential dependency). Above that it is a cost trap.

| Condition | Cheapest mechanism |
|---|---|
| Many light/mechanical items | low-fanout batches + Eco/Haiku-Sonnet tiering |
| Few (≤~10) large or dependent items | in-session subagents (N1) |
| ≤3 hard-sequential items | literal solo-serial |
| Many heavy items | parallel dispatch (NOT solo) |

## Isolation-overhead answer (folded-in question)

**Is per-spawn worktree isolation a real cost factor vs in-session? Only for tiny
tasks.** The isolation cost is the cold **cache_creation seed** each spawned agent
pays to build its own preamble+schemas+CLAUDE.md context — median **26,963 tokens**
across the light fleet (~169K rel-cost on Opus). As a share of the agent's full
cost: **~12% of a heavy agent, but it dominates a sub-150K light agent.** So:
isolation overhead is **negligible for substantial work** and **material only for
trivial/tiny items** — which is exactly the regime where in-session subagents (no
fresh seed) should be preferred over spawn_task. The worktree itself (git
plumbing) is not visible in token cost; the entire isolation premium is the
context re-seed, and it is a *one-time per-spawn* cost, not a recurring one.

## Measurement-confidence caveats

- **Mixed model generations** (opus-4-7/4-8, sonnet-4-6). The parser's *tier
  multipliers* are generation-stable, so relative comparisons hold; absolute
  per-session token counts are not prompt-size-normalized.
- **The solo model is calibrated to ONE long session** (cranky-lovelace) plus a
  cross-check (c8fe8b91). BASE_CR/SLOPE/compaction-cost are fitted estimates, not
  population stats — the *direction* (quadratic solo vs linear parallel) is robust
  and confirmed by the raw 1.48× half-over-half measurement; the exact crossover K
  (≈14) carries ±several items of uncertainty.
- **ORCH_PER_ITEM (600K) is an estimate** from low-context IM ops; a real IM op
  late in a session costs far more, which only strengthens "don't do it all solo."
- **Integration-master sessions double as solo references** — they are not pure
  "K identical work-items in a row," so the solo curve includes merge/review work.
  This biases solo *upward* somewhat, but the light-item finding (solo loses even
  at K=1) is independent of that bias.

## D1 notes (naming decision)

The data does **not** support unifying `Careful-Serial` → `Cheap-Slow`. They are
different axes:

- **Careful-Serial** (write-capable workflow variant) = *collision-safety*
  ordering of parallel agents; it is still parallel-tiered work, and per findings
  1–2 that is the *cheap* path. Careful-Serial is about correctness/merge-safety,
  not cost.
- **Cheap-Slow** (this spike) = a *cost posture* whose mechanism is "low-fanout +
  Eco tier + Haiku/Sonnet," optionally in-session subagents for the small-K corner
  — **not** literal solo.

**Recommendation: keep them separate names.** Folding them risks encoding the
refuted "cheap = literal solo" intuition into the variant taxonomy. D1's
three-dials design should treat *fan-out width*, *model/effort tier*, and
*isolation mode (spawn vs in-session vs solo)* as independent dials; "Cheap-Slow"
is a *preset* over those dials (narrow fan-out + low tier), and "Careful-Serial"
is an orthogonal ordering preset for the write-capable path.
