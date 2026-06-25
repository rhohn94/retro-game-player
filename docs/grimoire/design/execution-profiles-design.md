# Execution profiles — three orthogonal composable dials

> **Up:** [↑ Design docs](README.md)


> v1.11 "Execution profiles", D1 design gate. Authored after the **S1**
> empirical spike ([`docs/grimoire/execution-profile-spike-s1.md`](../execution-profile-spike-s1.md)),
> whose MEASURED findings are this design's evidence base and are honoured
> throughout. This doc defines the *model* (three dials + the speed/quality/cost
> triangle); E1–E4 implement it. Cross-links:
> [model-effort-profiles-design.md](model-effort-profiles-design.md),
> [write-capable-workflow-design.md](write-capable-workflow-design.md),
> [work-paradigm-design.md](work-paradigm-design.md),
> [token-efficiency-design.md](token-efficiency-design.md).

## Motivation

The scaffolding has accreted three independent cost/behaviour controls, but
they were never framed as one coherent, composable system:

1. **work-paradigm** (v1.6) — *who drives*: Supervised / Weiss / Noir. Active.
2. **workflow-variant** (v1.4, previewed) — *how work is dispatched*:
   Efficient / Fast / Careful-Serial. Still `in-development: true`, never
   graduated.
3. **model-effort-profile** (v1.9 preview → v1.10 active) — *which model
   tier*: High Effort … Eco/Budget. Active and switchable.

Two problems. First, the dials are **conflated**: v1.10 onboarding *recommends*
the `Autonomous` model-effort profile *because* the paradigm is Noir, implying
the autonomy and tier dials are coupled when they are not. Second, the dispatch
dial (`workflow-variant`) never graduated and its presets — built for
write-capable Workflows — were never connected to the project-level
*cost posture* a user actually wants to set. And the third preset
(`Careful-Serial`) is a collision-safety mode, not a cost posture at all,
muddying the taxonomy.

S1 was run to settle the central empirical question behind the cost posture:
**is a slow solo-serial session cheaper than parallel dispatch?** It is not, in
the general case (see [S1](../execution-profile-spike-s1.md)). That result
dictates how the cost-oriented dispatch preset must be *mechanically* defined —
the core of this design.

This doc establishes the **three dials as orthogonal and composable**, frames
them around the user's **speed / quality / cost triangle**, redefines the
dispatch dial's presets on S1's evidence, and reconciles `Careful-Serial` out of
the cost taxonomy. It leaves clean seams for E1 (graduate + switch skill), E2
(integration-master dispatch), E3 (decouple), and E4 (onboarding).

---

## Scope

**Covers:**
- The three orthogonal dials and their composition contract (§A).
- The speed/quality/cost triangle as the user-facing framing, and the mapping
  from each priority-pair to dial settings (§B).
- The S1-evidence-based mechanical definition of **Cheap-Slow** (§C).
- The reconciliation of `Careful-Serial` as an orthogonal write-capable-workflow
  ordering concern, not a cost preset (§D).
- How the active execution-strategy governs integration-master dispatch (§E,
  what E2 implements).
- Config-schema impact: graduating `workflow-variant`, the decoupling cleanup,
  the composition matrix + persona validation (§F).

**Does not cover (non-goals):**
- Implementing the graduation / switch skill (E1 owns it).
- Implementing the integration-master dispatch logic (E2 owns it).
- Implementing the onboarding decoupling (E3/E4 own it).
- The `copilot/` flavor port + golden re-baseline (D2 owns it).
- A budget → posture auto-selector and the **grm-priority-picker skill** (both
  Backlog; this design only keeps the dials clean enough that the picker's
  pair → settings mapping is trivial — see §B).
- Re-deriving S1's numbers; they are cited, not reproduced.
- The in-session-subagent execution machinery itself (deferred **N1**); this
  doc only specifies *when* Cheap-Slow selects it (§C/§E).

---

## Design

### A. The three orthogonal, composable dials

The system is exactly **three independent dials**. Each answers a different
question; any combination is valid; none implies another.

| Dial | Question it answers | Config field | Values | Status |
|---|---|---|---|---|
| **work-paradigm** | *Who drives* (autonomy) | `work-paradigm.value` | Supervised / Weiss / Noir | Active (v1.6) |
| **execution-strategy** | *How work is dispatched* (parallelism / dispatch posture) | `workflow-variant.value` | **Fast / Efficient / Cheap-Slow** | Graduating (E1) |
| **model-effort-profile** | *Which model tier* (quality) | `model-effort-profile.value` | High Effort / Medium / Low Effort / Efficient / Autonomous / Eco-Budget | Active (v1.10) |

> **Naming.** The dial is *conceptually* "execution-strategy"; its **config
> field stays `workflow-variant`** (no rename — avoids a schema churn and keeps
> the field that write-capable Workflows already read; see §F and §D). "Execution
> strategy" is the user-facing name for the same field. The dial's preset set
> changes from `{Efficient, Fast, Careful-Serial}` to **`{Fast, Efficient,
> Cheap-Slow}`** (see §D for the `Careful-Serial` migration).

**Orthogonality (the core contract).** The three dials are *independent inputs*:

- **work-paradigm** governs the human-gating posture and whether write-capable
  Workflows are even permitted (Noir only — see
  [write-capable-workflow-design.md §1](write-capable-workflow-design.md)). It
  does **not** dictate a tier or a dispatch posture.
- **execution-strategy** governs fan-out width / dispatch shape (how many
  agents, how parallel, spawn vs in-session). It does **not** dictate a tier.
- **model-effort-profile** governs the `{model, effort}` each work item resolves
  to (the v1.10 resolver,
  [model-effort-profiles-design.md §E7.5](model-effort-profiles-design.md)). It
  does **not** dictate dispatch shape.

Every cell of the 3 × 3 × N product is a legal configuration. The dials read
from `.claude/grimoire-config.json` independently, and the skills that consume
them (paradigm-switch / integration-master dispatch / the tier resolver) never
read another dial's field. §F validates this with three personas rather than the
full product.

> **Composition is the point.** "Speed" comes from execution-strategy, "quality"
> from model-effort-profile, "autonomy" from work-paradigm. Because they are
> orthogonal, the user composes a posture (e.g. *autonomous + cheap + decent
> quality* = Noir + Cheap-Slow + Eco) rather than choosing from a fixed menu of
> bundled modes.

### B. The speed / quality / cost triangle (user-facing framing)

The dials exist to serve one user principle:

> **You can prioritize at most two of {speed, quality, cost}.**

Each vertex maps to a dial (or a dial setting):

| Vertex | Realized by | Mechanism |
|---|---|---|
| **Speed** | execution-strategy = **Fast** | maximum parallel fan-out → minimum wall-clock |
| **Quality** | model-effort-profile = **High Effort** | Opus from a lower complexity baseline; high effort everywhere |
| **Cost** | execution-strategy = **Cheap-Slow** *and/or* model-effort-profile = **Eco-Budget** | low parallelism-waste (narrow fan-out, no duplicated reads) + cheap tiers (no/low Opus) |

Sacrificing one vertex picks the opposite dial setting on that axis. The three
priority-pairs map to dial combinations as follows:

| Priority pair | Sacrifices | Dial settings |
|---|---|---|
| **speed + quality** | cost | **Fast** + **High Effort** — max fan-out on Opus; you pay for both |
| **speed + cost** | quality | **Fast** + **Eco-Budget** (Haiku/Sonnet) — wide cheap fan-out; accept rework risk |
| **quality + cost** | speed | **Cheap-Slow** + **High-Effort-where-it-matters** — narrow fan-out + tiers that spend Opus only on `review`/`large` (e.g. the **Efficient** or **Autonomous** profile, not full High Effort) |

> **Why cost lives on two dials.** Cost is reduced by *both* low parallelism-waste
> (execution-strategy) *and* cheap tiers (model-effort-profile). The
> speed/quality/cost triangle is therefore a 2-dial projection of the 3-dial
> space: paradigm is autonomy, orthogonal to the triangle. A cost-priority user
> typically pulls both cost levers (Cheap-Slow + Eco); a quality+cost user pulls
> the cost lever on dispatch (Cheap-Slow) while keeping selective Opus on the
> tier dial.

**Seam for the grm-priority-picker skill (Backlog).** A future `grm-priority-picker`
skill will ask the user "which two of speed/quality/cost?" and write the dial
settings. The mapping above *is* its lookup table. The dials are designed so
this mapping is a pure function of the chosen pair → `{execution-strategy,
model-effort-profile}` (paradigm is asked separately, as autonomy is not part
of the triangle). No dial needs to know about the picker; the picker just writes
two config fields and calls the two switch skills.

### C. Cheap-Slow — defined by S1's evidence (NOT literal solo)

S1 **refuted** the intuition "cheap = slow solo." Solo-serial cost is
**quadratic** in item count K (a growing warm prefix re-read every turn, plus
periodic compaction), while parallel dispatch is **linear** in K. The measured
consequences ([S1 Findings 1–3](../execution-profile-spike-s1.md)):

- **Solo never beats parallel for light/mechanical items, at any K** — even at
  K=1 (745K parallel vs 1.06M solo), because a long solo session already carries
  a multi-MB warm prefix while a fresh light agent starts near-cold.
- **Solo beats parallel only for HEAVY items at small K (crossover ≈ K=14:**
  32.9M solo vs 30.7M parallel-heavy). Past it solo loses decisively — at K=50,
  solo is **2.3×** parallel-heavy and **6.3×** parallel-light.
- The per-spawn **isolation overhead** is the cold cache_creation re-seed,
  median **26,963 tokens** (~12% of a heavy agent but dominant for a sub-150K
  light agent) — material **only for trivial/tiny items**
  ([S1 Isolation-overhead](../execution-profile-spike-s1.md)).

Therefore **Cheap-Slow is a low-fan-out cost posture, not a literal solo session**
(the single costliest mechanism measured). Its mechanical definition:

| Condition (per work batch) | Cheap-Slow mechanism | S1 basis |
|---|---|---|
| Many light / mechanical items | **low fan-out, small batches**, parallel + tiered down (pairs with Eco-Budget; Haiku/Sonnet) | Findings 1, 3 — tier + output dominate cost, not fan-out width; solo loses at every K |
| Few (≤ ~10) large / dependent items | **in-session subagents** (deferred **N1**) — avoid K cold seeds without inheriting a giant solo prefix | Finding 2 + Isolation-overhead — wins the small-heavy corner more cleanly than literal solo |
| ≤ 3 hard-sequential items (or true sequential dependency) | **literal solo-serial** | Recommendation table — the only regime where solo is acceptable |
| Many heavy items | **parallel dispatch** (NOT solo) | Finding 2 — solo's quadratic growth inverts past ~K=14 |

In one line: **Cheap-Slow = narrow fan-out + small batches + pairs with the
Eco-Budget tier profile**, escalating to in-session subagents for the narrow
small-heavy corner and to literal solo only for ≤3 hard-sequential items. It is
*not* "do everything in one session" — S1 shows that is the cost trap, not the
cost saver.

> Cheap-Slow controls **fan-out width and isolation mode** (the dispatch dial).
> The *tier* lever (Eco-Budget, Haiku/Sonnet) lives on the model-effort dial and
> is its natural partner for a cost-priority posture (§B), but the two remain
> independently selectable — a user may run Cheap-Slow dispatch with a High
> Effort tier if they want "quality + cost, sacrifice speed" (§B row 3).

### D. Careful-Serial stays SEPARATE (per S1)

S1's naming decision is explicit ([S1 D1 notes](../execution-profile-spike-s1.md)):
`Careful-Serial` and `Cheap-Slow` are **different axes** and must not be folded:

- **`Careful-Serial`** = a **collision-safety ordering** mode for *write-capable
  Workflows* — agents merge one-at-a-time in conflict-map order to guarantee
  merge correctness (see
  [write-capable-workflow-design.md §4](write-capable-workflow-design.md)). It is
  still parallel-*tiered* work in spirit; it is about **merge correctness, not
  cost**. Per S1 Findings 1–2 the cheap path is *parallel + tiered-down*, so
  treating serial execution as the "cheap" preset would encode the **refuted**
  "cheap = literal solo" intuition into the taxonomy.
- **`Cheap-Slow`** = a project-level **cost posture** (§C).

**Resolution.** The project-level **execution-strategy presets are `{Fast,
Efficient, Cheap-Slow}`**. `Careful-Serial` is **removed from the project-level
preset set** and **remains an orthogonal ordering concern internal to
write-capable Workflows**.

**Migration (reconciling [write-capable-workflow-design.md §4](write-capable-workflow-design.md),
which currently lists Careful-Serial as the 3rd variant):**

1. **Two distinct concepts, two distinct surfaces.** The *project* config field
   `workflow-variant.value` (the execution-strategy dial) takes
   `{Fast, Efficient, Cheap-Slow}`. The *write-capable Workflow* keeps its own
   **execution-variant** concept `{Efficient, Fast, Careful-Serial}` as a
   per-Workflow invocation argument (`args.variant`), exactly as documented in
   write-capable-workflow-design.md §4.2.
2. **No silent reuse of one name for two meanings.** The dial value `Cheap-Slow`
   and the Workflow argument `Careful-Serial` are different identifiers — they
   never collide. The old preview value `Careful-Serial` in `workflow-variant`
   (set by [work-paradigm-design.md §5.1](work-paradigm-design.md)) is **retired
   from the project field** at graduation (E1): a config carrying
   `workflow-variant.value: "Careful-Serial"` is migrated to the nearest cost
   posture — **`Cheap-Slow`** (a serial-leaning project would have wanted the
   low-fan-out cost posture). E1 owns this value migration.
3. **write-capable-workflow-design.md §4 is amended** (a D2 doc-propagation
   note) to add a one-line cross-reference: its `Careful-Serial` is the
   Workflow-internal ordering variant, distinct from the project
   execution-strategy dial defined here; its preset list is unchanged.

> Net: the *write-capable Workflow* still chooses Efficient/Fast/Careful-Serial
> at invocation for merge-safety; the *project* chooses Fast/Efficient/Cheap-Slow
> as its dispatch cost posture. The integration master, when it dispatches via a
> write-capable Workflow under Noir, maps its active execution-strategy to a
> Workflow variant (§E).

### E. How execution-strategy governs the integration master (E2)

`grm-release-phase` (and, under Noir, the F2 default-dispatch path in
[work-paradigm-design.md §6](work-paradigm-design.md)) reads
`workflow-variant.value` to choose its **dispatch shape**. This is what E2
implements; the dial governs *fan-out width and isolation mode*, never tier.

| execution-strategy | Integration-master dispatch behaviour |
|---|---|
| **Fast** | **Max fan-out** — spawn every independent item in the current batch concurrently; accept duplicated reads / reactive conflict handling. Minimum wall-clock. (When dispatching through a write-capable Workflow under Noir, select the Workflow's **Fast** variant.) |
| **Efficient** | **Balanced** — today's default. Parallel with conflict-map–respecting batches, dedup of shared reads, `mergeAfter` ordering. (Write-capable Workflow → **Efficient** variant.) |
| **Cheap-Slow** | **Low fan-out** — small batches (bounded peak orchestrator context), parallel + tiered-down for light/mechanical work; **in-session subagents (N1)** for the ≤ ~10 small-heavy/dependent corner; literal solo only for ≤ 3 hard-sequential items (§C). Pairs with Eco-Budget tiers. (Write-capable Workflow → **Careful-Serial** variant for the serial corner, else low `maxConcurrency`.) |

**Seam for E2.** `grm-release-phase` Step 3 already resolves *tier* via the v1.10
model-effort resolver. E2 adds, alongside it, an **execution-strategy read**
that sizes the batch (fan-out width) and selects the isolation mode
(spawn / in-session / solo). The two reads are independent: tier from
`model-effort-profile`, fan-out from `workflow-variant`. E2 must not couple them
(reaffirming the
[write-capable-workflow-design.md §2.6](write-capable-workflow-design.md)
decoupling principle: tier and dispatch are separate knobs).

> **N1 dependency note.** The in-session-subagent mechanism is deferred (N1).
> Until N1 lands, Cheap-Slow's small-heavy corner falls back to **small-batch
> spawn_task** (still cheaper than wide fan-out or solo for that K range per S1),
> and literal solo remains available for ≤3 hard-sequential items. E2 should
> implement the fan-out sizing now and leave a clean call-site for N1's
> in-session path.

### F. Config + decoupling

#### F.1 execution-strategy graduation (E1) — mirror model-effort-profile's flag-drop

The `workflow-variant` field has been `in-development: true` since v1.4
([work-paradigm-design.md §5.1](work-paradigm-design.md) row). Graduation
follows the **model-effort-profile precedent (v1.10 P1)** exactly, which
required **no schema-version bump**
([model-effort-profiles-design.md §5.6](model-effort-profiles-design.md)):

- The field already exists at the current `schema-version: 3`. Graduation
  **drops `in-development` only** — a flag removal, not a structural change — so
  **no version bump** (verified against the model-effort-profile precedent: the
  field was added at v3 in v1.9, and v1.10 graduation dropped the flag without
  bumping; same shape here, where `workflow-variant` was added pre-v3).
- E1 ships a **`grm-workflow-variant-switch` skill** (a.k.a. execution-strategy
  switch), mirroring `grm-model-effort-profile-switch`: validate the value against
  the preset set `{Fast, Efficient, Cheap-Slow}` (case-insensitive), drop any
  legacy `in-development`, perform the §D value migration
  (`Careful-Serial` → `Cheap-Slow`), and write the validated value. **No
  file-swap** — like the model-effort profile, the strategy is pure data that
  `grm-release-phase`/the master reads live, so writing the field *is* activation.
- **Forward-compat:** a config with `workflow-variant.value: "Efficient",
  in-development: true` reads identically to a graduated `Efficient` (the dial
  was already `Efficient`-default). A config with the retired value
  `Careful-Serial` migrates to `Cheap-Slow` on first switch.

Resulting graduated config shape (no version bump from current v3):

```json
{
  "schema-version": 3,
  "name": "Grimoire",
  "work-paradigm": { "value": "Supervised" },
  "workflow-variant": { "value": "Efficient" },
  "model-effort-profile": { "value": "Medium" }
}
```

#### F.2 Decoupling cleanup (E3)

The v1.10 onboarding "**recommend Autonomous profile under Noir**" coupling
([model-effort-profiles-design.md §E7.6](model-effort-profiles-design.md))
becomes a **non-binding suggestion**, and all three dials become independently
selectable:

- **Keep** the Noir → Autonomous *recommendation* as a highlighted, reasoned
  default (it already says "Because you chose Noir, I recommend…"). E3 confirms
  it is presented as a suggestion the user can override for **any** registry
  profile — it must never silently force the tier from the paradigm.
- **Add** the execution-strategy as its **own** onboarding choice (E4), so a
  Noir user can pick, e.g., Cheap-Slow dispatch with the Autonomous tier, or
  Fast dispatch with Eco-Budget — any combination.
- **Remove any code path** that infers one dial's value *from another dial's
  value* as a hard rule. The only cross-dial relationship that survives is
  advisory text in the onboarding interview (a recommendation, not a write).

> This makes the §A orthogonality contract *operational*: after E3, no switch
> skill or onboarding step writes a dial value as a function of another dial's
> value.

#### F.3 Composition matrix + persona validation

The full space is 3 paradigms × 3 strategies × N (6) profiles = 54 combinations.
We do **not** validate all 54; we validate the **three user personas** that
exercise the meaningful corners:

| Persona | work-paradigm | execution-strategy | model-effort-profile | Triangle priority |
|---|---|---|---|---|
| **cheap-autonomous** | Noir | **Cheap-Slow** | **Eco-Budget** | cost (+ autonomy); sacrifice speed & quality |
| **fast-efficient** | Supervised | **Fast** *(or Efficient)* | **Efficient** | speed + balanced cost; sacrifice peak quality |
| **quality-focused** | Supervised / Weiss | **Efficient** | **High Effort** | quality (+ speed); sacrifice cost |

Each persona must (a) be a legal config the three switch skills accept, (b)
produce the expected dispatch shape (§E) and tier resolution
([model-effort-profiles-design.md §E7.5](model-effort-profiles-design.md))
*independently*, and (c) round-trip through onboarding (E4) without one dial
overriding another (§F.2). Validating these three is sufficient evidence that
the dials compose; the remaining combinations are interpolations between them.

---

## Config schema impact

- **No new field, no version bump.** The execution-strategy dial reuses the
  existing `workflow-variant` object at `schema-version: 3`. Graduation drops
  `workflow-variant.in-development` (§F.1) — structurally identical to the
  model-effort-profile graduation, which also did not bump the version.
- **Preset value set changes** for `workflow-variant.value`:
  `{Efficient, Fast, Careful-Serial}` → **`{Fast, Efficient, Cheap-Slow}`**
  (canonical; accepted case-insensitively). Default stays **`Efficient`**.
- **Value migration:** legacy `Careful-Serial` → `Cheap-Slow`, performed by the
  E1 switch skill on first invocation (§D).
- **No registry file.** Unlike model-effort-profile (which needs
  `.claude/model-effort-profiles.json` because tiers are a data matrix), the
  three execution-strategy presets are behavioural and live in the consuming
  skills (`grm-release-phase` / integration-master); the config field stores only
  the active value. No new framework file ships.
- **Bootstrap / golden:** `grm-workflow-bootstrap` golden config drops the
  `in-development` flag and carries `workflow-variant.value: "Efficient"`. D2
  owns the golden re-baseline + copilot mirror.
- **work-paradigm and model-effort-profile fields are untouched** — the §A
  invariant that the dials are independent holds at the schema level too.

---

## Acceptance

- [ ] Design doc at `docs/design/execution-profiles-design.md` in house layout;
      indexed in `docs/design/README.md`.
- [ ] Three orthogonal composable dials defined with the independence contract:
      work-paradigm / execution-strategy / model-effort-profile (§A).
- [ ] The speed/quality/cost triangle is the user-facing framing, with each
      vertex mapped to a dial and all three priority-pairs mapped to dial
      settings (§B), and the priority-picker seam noted as Backlog.
- [ ] **Cheap-Slow** is defined mechanically by S1's evidence — low fan-out +
      small batches + Eco tiers, in-session subagents (N1) for the small-heavy
      corner, literal solo only for ≤3 hard-sequential items — and explicitly
      **not** literal solo, citing S1's crossover (≈K=14) and isolation-overhead
      (~27K) numbers (§C).
- [ ] **Careful-Serial** is kept separate from the cost taxonomy: project presets
      are `{Fast, Efficient, Cheap-Slow}`; Careful-Serial remains a write-capable
      Workflow ordering variant; the migration reconciling
      write-capable-workflow-design.md §4 is specified (§D).
- [ ] How execution-strategy governs integration-master dispatch is specified
      (Fast → max fan-out, Efficient → balanced default, Cheap-Slow → low
      fan-out / in-session), as the E2 contract (§E).
- [ ] Config + decoupling specified: graduation mirrors model-effort-profile's
      flag-drop (no schema bump, verified against precedent); the Noir →
      Autonomous recommendation becomes non-binding; composition matrix validated
      via the three personas (§F).
- [ ] Clean seams for E1 (graduate + switch skill), E2 (master dispatch), E3
      (decouple), E4 (onboarding); D2 propagation note for claude-code + copilot
      + golden.
- [ ] Cross-links present: S1 findings, model-effort-profiles-design,
      write-capable-workflow-design, work-paradigm-design, token-efficiency-design.

---

## Open questions

- **In-session subagent (N1) timing.** Cheap-Slow's small-heavy corner is
  specified to use in-session subagents, but N1 is deferred. §E gives a
  spawn-fallback until N1 lands; the open item is whether v1.11 ships Cheap-Slow
  with the spawn-fallback only (recommended) or pulls N1 forward. Recommendation:
  ship fallback now, leave the call-site for N1.

## Follow-ups

- **E1** (graduate + switch skill): drop `workflow-variant.in-development`; ship
  `grm-workflow-variant-switch` (mirror `grm-model-effort-profile-switch`); migrate the
  preset set + the legacy `Careful-Serial` → `Cheap-Slow` value (§D, §F.1). No
  schema bump.
- **E2** (integration-master dispatch): make `grm-release-phase` / the Noir F2 path
  read `workflow-variant.value` and choose fan-out width + isolation mode per §E,
  decoupled from the tier resolver. Leave a clean N1 in-session call-site.
- **E3** (decouple): make the Noir → Autonomous tier recommendation non-binding;
  remove any dial-derives-from-dial write path (§F.2).
- **E4** (onboarding): add execution-strategy as its own onboarding question
  (Fast / Efficient / Cheap-Slow), independent of paradigm and tier; honor the
  `SKIP ONBOARDING` inference (explicit strategy token wins, else `Efficient`).
- **D2** (propagation): dogfood into root; port to `copilot/`; re-baseline golden
  config (drop `in-development`); amend
  [write-capable-workflow-design.md §4](write-capable-workflow-design.md) with the
  one-line cross-reference (§D step 3); add the version-history + roadmap entries.
- **Backlog — grm-priority-picker skill:** ask "which two of speed/quality/cost?" and
  write the dial settings per the §B mapping table.
- **Backlog — N1 in-session subagents:** the execution mechanism Cheap-Slow's
  small-heavy corner targets (§C/§E).
- **Backlog — budget → posture auto-selector:** once a measured budget is
  available, auto-recommend `{execution-strategy, model-effort-profile}` (extends
  the model-effort-profile budget-auto-selection follow-up).
