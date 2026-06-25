# Model/effort distribution profiles + task-name tier tags

> **Up:** [↑ Design docs](README.md)


## Motivation

Every spawned work-item session runs at some `model`/`effort` tier. Today that
tier is chosen from a **single hard-coded table** that lives in two places — the
`grm-repo-reference` skill (the canonical *size/complexity → model + effort* lookup)
and a duplicated copy in `grm-release-phase` Step 3. There is exactly one
distribution baked in, and a project that wants a different cost posture (e.g.
"never spend Opus" for a budget run, or "lean on high effort everywhere" for a
gnarly architecture release) must hand-edit the table in place — a change that is
easy to get wrong, drifts between the two copies, and is invisible at the moment
work is dispatched.

Model and effort selection is the single largest token-and-cost lever in the
workflow: it governs how much Opus exposure a release incurs and how aggressively
small/mechanical items are pushed down to Haiku. The
[token-efficiency-design.md](token-efficiency-design.md) effort (E1, authored in
parallel) treats this distribution as a first-class cost dial. This design makes
that dial **selectable** rather than hand-edited:

- **E7** extracts the table to one resolvable location and makes the active
  distribution a named **profile** stored in `.claude/grimoire-config.json`,
  mirroring the existing `workflow-variant` pattern — so all referencing skills
  resolve through the active profile with no per-skill edits.
- **E8** makes the resolved tier **visible at dispatch** by carrying it in the
  spawned task's name (e.g. `[opus/high] Implement X`), because `spawn_task`
  cannot set the spawned session's model — the name is the only carrier.

---

## Scope

**Covers (E7):**

- Extraction of the canonical *complexity-band → model + effort* table to ONE
  resolvable location (the profile registry).
- Five concrete starter profiles (Medium/default, High Effort, Low Effort,
  Efficient, Eco/Budget), specified as a profile × complexity-band matrix.
- Config schema change: a `model-effort-profile` field in
  `.claude/grimoire-config.json`, mirroring `workflow-variant` (accepted values,
  defaulting, `in-development` forward-compat, schema-version handling).
- The resolution mechanism every referencing skill uses (`grm-release-phase` Step 3,
  `grm-repo-reference`) — a single lookup, no per-skill table edits.
- Where the profile preference is captured (onboarding — an active choice as of
  v1.10/P3; an **independent** dial defaulting to `Medium` for every paradigm
  since v1.11/E3 decoupled the dials — see E7.6 and
  [`execution-profiles-design.md`](execution-profiles-design.md)).

**Covers (E8):**

- The exact format and placement of the `[model/effort]` tag in every spawned
  task name, and how it derives from the active profile (E7).
- Which skills/docs change to emit the tag (`grm-release-phase` task assignment +
  chip generation).

**Does not cover (non-goals):**

- Per-item *manual override* of the resolved tier (the integration master may
  always hand-edit a single chip; this design does not add a config surface for
  per-item overrides — see Open questions).
- Custom user-authored profiles beyond the five starters (the registry format
  permits it, but adding/validating bespoke profiles is a follow-up).
- Measuring the actual token/cost delta between profiles — that is E1/E2's
  measurement harness, cross-linked, not duplicated here.
- The `copilot/` flavor port (a later migration step per `CLAUDE.md` §Source of
  truth; `claude-code/` canonical lands first).
- Auto-selecting a profile from a measured budget (future; see Follow-ups).

---

## Design

### E7 — Selectable model/effort distribution profiles

#### E7.1 Problem framing

The status quo is one table, two copies, edited in place:

| Today | Problem |
|---|---|
| Canonical table in `grm-repo-reference` SKILL.md (`work type → model/effort`) | Phrased by *work type*, not by a band that release-phase can mechanically resolve from a token estimate. |
| Duplicated table in `grm-release-phase` Step 3 (`est. tokens → model/effort`) | Two sources of truth that can drift. |
| Editing posture = hand-edit the table | No named, reviewable, swappable "distribution"; no record of *which* posture a project chose. |

E7 replaces "one hard-coded table edited in place" with "one **profile
registry** + an active-profile **selector** in config + a single **resolver**
every skill calls."

#### E7.2 Complexity bands (the resolution axis)

All profiles resolve along the same ordered **complexity bands**, derived from
the work item's token estimate plus a design/review flag. Bands are
profile-invariant; only the *model+effort each band maps to* changes per profile.

| Band | Trigger |
|---|---|
| **trivial** | ≤ 15 K est. tokens; mechanical/read-only (lookups, text extraction, search) |
| **small** | 15 K–40 K est. tokens; localized edits, single-file changes |
| **medium** | 40 K–80 K est. tokens; multi-file implementation, test runs |
| **large** | > 80 K est. tokens; cross-cutting implementation |
| **review** | any planning, code review, security review, architecture/design analysis (regardless of token estimate) |

> The current `grm-repo-reference` "work type" rows map onto these bands:
> read-only/mechanical → **trivial**; implementation/mid-complexity →
> **small**/**medium**; planning/review/architecture → **review**. The two
> UX rows (`grm-design-language-adapt`, `grm-ux-demo-build`) are special-cased pins
> (see E7.5) and resolve outside the band axis.

#### E7.3 The five starter profiles

Each profile maps every band to a `model`/`effort` pair. `inherit` means "do not
override the session's inherited effort." The **Medium** profile is exactly
today's behaviour (no change for existing projects that default to it).

| Band | **Medium** (default) | **High Effort** | **Low Effort** | **Efficient** | **Autonomous** | **Eco/Budget** |
|---|---|---|---|---|---|---|
| trivial | haiku / low | haiku / medium | haiku / low | haiku / low | haiku / low | haiku / low |
| small | sonnet / inherit | sonnet / high | haiku / low | sonnet / low | sonnet / low | haiku / low |
| medium | sonnet / inherit | opus / high | sonnet / low | sonnet / medium | sonnet / medium | sonnet / low |
| large | opus / high | opus / high | sonnet / medium | opus / high | sonnet / high | sonnet / medium |
| review | opus / high | opus / high | sonnet / medium | opus / high | opus / high | sonnet / medium |

> **Autonomous** is added in v1.10 P2 (a registry-only profile, not one of the
> five v1.9 starters).

Posture summary (the intent each profile encodes):

- **Medium** *(default — current configuration)* — the table shipping today.
  Opus only for `large` + `review`; Sonnet is the implementation workhorse;
  Haiku for trivial.
- **High Effort** — bias toward high+ effort everywhere; bring Opus in from a
  *lower* complexity baseline (`medium` band, not just `large`). For a release
  where correctness dominates cost.
- **Low Effort** — aggressive push-down: Haiku for trivial *and* small, trust
  Sonnet with bigger tasks, low/medium effort throughout, no Opus. Fast and
  cheap; accepts more rework risk.
- **Efficient** — like Low Effort on the cheap end (Haiku trivial, lean Sonnet)
  but restores an **Opus allowance for genuinely high-complexity** work
  (`large` + `review`). The "spend where it matters, save elsewhere" middle.
- **Autonomous** *(v1.10 P2 — the Noir fan-out profile)* — derived from
  **Efficient**, with one deliberate change: **`large` → Sonnet** (Efficient
  keeps Opus at `large`), while **`review` stays Opus** to preserve the quality
  gate. The intent is to minimize Opus exposure across *wide* autonomous
  fan-out, where the v1.9 model-tier audit (E5) found that most large items are
  mechanical, cross-file implementation that does not need Opus — pushing each
  such large agent down to Sonnet is roughly a 5× per-agent rate cut, which
  compounds heavily when many run in parallel. Opus is reserved for `review`,
  where correctness judgement still earns it. Contrast with Efficient
  (`large` → Opus): Efficient optimizes a *single* high-complexity item's
  quality; Autonomous optimizes aggregate throughput cost across many
  concurrent large items. This is the profile **P3 will auto-select under the
  Noir paradigm** (P3 implements the auto-selection; this row only defines the
  profile it selects).
- **Eco/Budget** — **no Opus at all**. Sonnet for medium-large; Haiku for
  small/mechanical. The hard cost ceiling for budget-constrained runs.

> Token-cost tie-in: the lever each profile pulls is **Opus exposure** (the
> dominant per-token cost) and **effort level** (which scales output/thinking
> tokens). See [token-efficiency-design.md](token-efficiency-design.md) for the
> cost model these profiles feed into; this doc owns the *distribution*, that doc
> owns the *measurement*.

#### E7.4 The profile registry (one resolvable location)

The canonical table moves out of prose-in-`grm-repo-reference` into a single
machine-resolvable registry, the **profile registry**, at:

```
.claude/model-effort-profiles.json
```

Shape (the five starters ship here; the file is the one source of truth):

```json
{
  "schema-version": 1,
  "default-profile": "Medium",
  "bands": ["trivial", "small", "medium", "large", "review"],
  "profiles": {
    "Medium": {
      "trivial": { "model": "haiku",  "effort": "low" },
      "small":   { "model": "sonnet", "effort": "inherit" },
      "medium":  { "model": "sonnet", "effort": "inherit" },
      "large":   { "model": "opus",   "effort": "high" },
      "review":  { "model": "opus",   "effort": "high" }
    },
    "High Effort":  { "...": "per E7.3 column" },
    "Low Effort":   { "...": "per E7.3 column" },
    "Efficient":    { "...": "per E7.3 column" },
    "Eco/Budget":   { "...": "per E7.3 column" }
  }
}
```

`grm-repo-reference` SKILL.md stops embedding the literal table; instead it
*documents the bands and the five profiles* and points at this registry +
the active-profile config field as the source of truth. (`grm-repo-reference`
remains the human-readable orientation doc; the registry is the data.)

#### E7.5 The resolver (what skills call)

A single resolution procedure, used identically by `grm-release-phase` Step 3 and by
any agent consulting `grm-repo-reference`:

1. Read `model-effort-profile.value` from `.claude/grimoire-config.json`
   (E7.6). If absent/unset → use the registry's `default-profile` (`Medium`).
2. Load `.claude/model-effort-profiles.json`; select `profiles[<active>]`. If the
   named profile is missing from the registry → fall back to `default-profile`
   and emit a one-line warning (fail-safe, never fail-closed on dispatch).
3. Classify the work item into a **band** (E7.2) from its token estimate +
   design/review flag.
4. Return `profiles[<active>][<band>]` → the `{model, effort}` pair.
5. **UX pins (special-case, profile-invariant):** `grm-design-language-adapt`
   resolves to `sonnet`/`medium` and `grm-ux-demo-build` to `sonnet`/`high`
   regardless of active profile — these are fixed by the skills, not the band
   axis, and the resolver returns them directly when the item is one of those
   skills. (Documented as today; unchanged by E7.)

No skill embeds the band→tier mapping any more — the mapping lives only in the
registry, selected by the config field. Adding/altering a profile is a
registry-only edit; **zero per-skill changes**.

#### E7.6 Where the preference is captured

The profile is captured at **onboarding as a real, active choice** (no longer a
preview field). The field shipped previewed in v1.9 (`in-development: true`),
graduated to active in v1.10 (P1, the switch skill + resolver), and is wired
into the onboarding interview in v1.10 (P3). The `grm-onboarding` interview adds a
question — Step 5, "Choose your model/effort profile (cost posture)" — offering
the six registry profiles (`Medium`, `High Effort`, `Low Effort`, `Efficient`,
`Autonomous`, `Eco/Budget`) with one-line postures. The chosen value is written
**active** (`{ value }`, no `in-development` key) to
`.claude/grimoire-config.json`, and onboarding immediately activates it by
calling `grm-model-effort-profile-switch` (post-config-write, mirroring the §3.1
`grm-work-paradigm-switch` invocation). There is no file-swap — the profile is pure
data the resolver (E7.5) reads live, so writing the validated field *is* the
activation.

**The model/effort profile is an independent dial (v1.11 / E3 decoupling).**
The default is **`Medium`** (the registry `default-profile`) for **every**
paradigm — the profile does **not** auto-derive from the work paradigm. The
v1.10 "recommend/auto-select `Autonomous` under Noir" coupling was a
soft-coupling between two of the three orthogonal dials; v1.11 (E3) softens it
to a **non-binding one-line hint**, never a paradigm-conditional default and
never a silent force:

> "Teams running Noir often pair the **Autonomous** profile with the
> **Cheap-Slow** execution strategy for cheap autonomy, but any combination of
> the three dials is valid."

The user freely picks any registry profile; the highlighted default stays
`Medium` regardless of paradigm. The `SKIP ONBOARDING` non-interactive path
infers the same: an explicit profile token in the prompt wins; otherwise it
falls back to `Medium` (not paradigm-conditional) and activates via the switch
skill.

The three dials — work-paradigm (autonomy) × execution-strategy
(`workflow-variant`, dispatch) × model-effort-profile (tier) — are **orthogonal
and independently selectable**; none auto-derives another. The full
triangle/matrix and the orthogonality contract live in
[`execution-profiles-design.md`](execution-profiles-design.md) (§A/§B/§F).

Switching the active profile after onboarding uses the same
`grm-model-effort-profile-switch` skill — it validates the value against the
registry and writes the config field; the resolver then reads it live.

### E8 — Model + effort in task names

#### E8.1 Problem framing

`spawn_task` cannot set the spawned session's model (`grm-release-phase` Step 3 says
so explicitly). The recommended tier is therefore communicated only in prose
inside the chip prompt, where it is easy to miss and impossible to scan across a
batch. Carrying the resolved tier **in the visible task name** makes it
reviewable at a glance for every chip in a phase, and makes the active-profile's
effect on a release self-evident in the chip list.

#### E8.2 Tag format and placement

Every spawned task **name** (the `spawn_task` `title`) carries a leading tier
tag:

```
[<model>/<effort>] <ITEM-ID>: <short title>
```

- **Format:** `[` + lowercase `model` + `/` + lowercase `effort` + `]`, then a
  single space, then the existing title. Examples:
  `[opus/high] E7: model/effort profiles`,
  `[sonnet/inherit] E3: output-minimization pass`,
  `[haiku/low] C1: coherence cleanup`.
- **Placement:** **leading** — first token of the name — so it aligns and is
  scannable down a column of chips. The integration master may still append the
  human-readable "set model …" reminder in the prompt body (the tag is the
  carrier; the prompt body is the instruction).
- **Effort `inherit`:** rendered literally as `inherit`
  (`[sonnet/inherit] …`) — it is information ("don't override"), not noise.

#### E8.3 Derivation

The tag's `<model>`/`<effort>` are **exactly** the resolver output from E7.5 for
that item — there is no second source. E8 is purely a *rendering* of E7's
resolution into the name. If E7 is not yet active (config field absent), the
resolver's default-profile (`Medium`) output is used, so E8 is well-defined even
before E7 activation.

#### E8.4 Skills/docs that change

| Surface | Change |
|---|---|
| `grm-release-phase` SKILL.md Step 3 | Replace the embedded `est. tokens → model/effort` table with a call to the E7 resolver (E7.5); state that the resolved tier is rendered into the task name per E8.2. |
| `grm-release-phase` SKILL.md Step 5 (chip generation) | Change the `title` template from `{ITEM-ID}: {short title} — set model {model}/{effort}` to `[{model}/{effort}] {ITEM-ID}: {short title}`; keep the prose "set this model/effort in your session" line in the prompt body. |
| `grm-release-phase` SKILL.md Anti-patterns | Update "forgetting to name the recommended model in the chip" to reference the leading tag. |
| `grm-repo-reference` SKILL.md | Replace the literal subagent table with the band definitions + the five-profile summary + a pointer to the registry and the active-profile config field (E7.4). |

---

## Config schema impact

Mirror the `workflow-variant` field precisely (see
[work-paradigm-design.md](work-paradigm-design.md) §5 for the established
`in-development` / schema-version pattern).

### New field

`.claude/grimoire-config.json` gains a `model-effort-profile` object. v1.9 shipped
it previewed (`in-development: true`); v1.10 (P1) graduated it by dropping that
flag (see §5.6). The two shapes:

```json
// v1.9 preview shape (in-development)
{ "model-effort-profile": { "value": "Medium", "in-development": true } }

// v1.10 graduated shape (active — the resolver reads value live)
{
  "schema-version": 3,
  "name": "Grimoire",
  "work-paradigm": { "value": "Supervised" },
  "workflow-variant": { "value": "Efficient", "in-development": true },
  "model-effort-profile": { "value": "Medium" }
}
```

- **`model-effort-profile.value`** — one of `Medium | High Effort | Low Effort |
  Efficient | Eco/Budget` (canonical). Accepted case-insensitively on input.
- **`model-effort-profile.in-development`** — was `true` while previewed in v1.9
  (captured at onboarding, resolver hard-defaulted to Medium); **dropped at v1.10
  graduation** (P1), exactly as `work-paradigm.in-development` was dropped at its
  activation. A graduated config carries `model-effort-profile.value` with no
  `in-development` key (see §5.6).
- **Default / absent:** if the object or `.value` is missing → resolver uses the
  registry `default-profile` (`Medium`). Old configs that never had the field
  behave identically to today.

### Schema-version handling

- Adding the field bumped `schema-version` to **3** in v1.9 (was 2). The bump is
  additive: a v2 config (no `model-effort-profile`) is forward-compatible —
  readers treat a missing field as `Medium`/default, so no migration is forced.
  **Graduation (v1.10, P1) drops `in-development` only and does NOT bump the
  version** — the field already lives at schema-version 3; activation is a
  flag-removal, not a structural change (see §5.6). The
  `grm-model-effort-profile-switch` skill performs that flag-drop and writes the
  validated value, the same migration shape `grm-work-paradigm-switch` uses (minus
  the file-swap — the profile is pure data).
- The registry file `.claude/model-effort-profiles.json` carries its **own**
  independent `schema-version` (starts at `1`) so the profile *data* can evolve
  separately from the project config.

### Bootstrap / golden

`grm-workflow-bootstrap` (and the golden baseline) must ship
`.claude/model-effort-profiles.json` as a framework file so a fresh or restored
scaffold has the five starters. This is paradigm-invariant (the registry is the
same across Supervised/Weiss/Noir). Implementation-owned, flagged in Follow-ups.

### §5.6 — Graduation (v1.10, P1)

> Mirrors how `work-paradigm-design.md` §5 recorded the work-paradigm v1→v2
> graduation: the field was previewed first, then activated in a later release
> by dropping `in-development`. This subsection is the activation record.

v1.9 shipped the system as a **preview** (`in-development: true`, no behavioural
effect — the resolver hard-defaulted to `Medium`). v1.10's **P1** graduates it to
**active**:

| Aspect | v1.9 (preview) | v1.10 (graduated, P1) |
|---|---|---|
| `model-effort-profile.in-development` | `true` | **dropped** (absent) |
| `schema-version` | `3` | `3` (**unchanged** — the add already bumped it in v1.9; graduation is a flag-drop, not a structural change) |
| Resolver behaviour | preview / hard-defaults to `Medium` | **active** — `grm-release-phase` Step 3 resolves dispatch `{model, effort}` live through the active profile (`grm-repo-reference` §The resolver) |
| Switch mechanism | "config edit suffices" (Follow-up) | **`grm-model-effort-profile-switch` skill** — validates against the registry, idempotent, drops any legacy `in-development`, writes the value (no file-swap; the resolver reads config live) |

**Behaviour unchanged for default users.** The default profile is `Medium`, whose
band × tier matrix (E7.3) is *exactly* today's table: trivial → haiku/low,
small + medium → sonnet/inherit, large + review → opus/high. A config with no
`model-effort-profile` (a pre-graduation v2 config), or one with value `Medium`,
both resolve to that identical table. Graduation activates *switchability*, not a
distribution change — projects that never touch the field see no difference.

**Why the schema-version is NOT bumped at graduation.** This differs from
work-paradigm, whose graduation *was* a version bump (v1→v2) because that bump
both added and activated the field in one release. Here the field was already
added at schema-version 3 in v1.9; the only graduation delta is removing the
`in-development` preview flag. A v3-preview config and a v3-graduated config are
structurally identical except for that one optional key, so no version bump is
warranted and forward-compat is preserved (a reader that still sees
`in-development` treats it as advisory; the resolver ignores it).

**Seams left clean for downstream v1.10 work.** Graduation deliberately does
*not* implement the dependent items, only makes the system active + switchable:

- **P2** adds an `Autonomous` profile — a registry-only edit
  (`.claude/model-effort-profiles.json` `profiles` key) + an alias row in
  `grm-model-effort-profile-switch` §1; no resolver change.
- **P3** wires onboarding to capture/activate the profile — it can call
  `grm-model-effort-profile-switch` post-config-write (same shape as onboarding
  calling `grm-work-paradigm-switch`).
- **P4** adds a `workflow-overrides` block — an additive registry/config
  extension consumed by the resolver; the single-resolver seam (E7.5) is the
  insertion point.

---

## Acceptance

- [ ] Design doc exists at `docs/design/model-effort-profiles-design.md` and is
      indexed in `docs/design/README.md`.
- [ ] The complexity-band axis is defined (trivial/small/medium/large/review)
      with triggers, and the current `grm-repo-reference` work-types are mapped onto
      it (E7.2).
- [ ] All five starter profiles are specified as a complete band × profile matrix
      (E7.3), with Medium == today's behaviour.
- [ ] The profile registry location, shape, and "one source of truth" role are
      specified; `grm-repo-reference`'s literal table is shown being replaced by a
      pointer (E7.4).
- [ ] A single resolver procedure is specified that `grm-release-phase` Step 3 and
      `grm-repo-reference` both use, with default/missing-profile fallback and the UX
      pins special-cased (E7.5) — with NO per-skill band→tier table remaining.
- [x] The onboarding capture is specified (E7.6) — an active choice, an
      **independent** dial defaulting to `Medium` for every paradigm (v1.11/E3
      decoupled it; the former Noir → `Autonomous` recommendation is now a
      non-binding hint), activated via `grm-model-effort-profile-switch` (wired in
      v1.10/P3).
- [ ] The task-name tag format `[<model>/<effort>] <ITEM-ID>: <title>` is
      specified, leading-placement, with `inherit` rendered literally (E8.2).
- [ ] The tag is shown deriving solely from the E7 resolver, well-defined even
      pre-activation (E8.3).
- [ ] The exact `grm-release-phase` Step 3 / Step 5 / Anti-pattern edits and the
      `grm-repo-reference` edit are enumerated (E8.4).
- [ ] Config schema impact is specified: new `model-effort-profile` field,
      `in-development` lifecycle, defaulting, schema-version 2→3, registry's own
      version, bootstrap/golden ship (Config schema impact §).
- [ ] `token-efficiency-design.md` is cross-linked by name as the cost model
      this profile feeds.

---

## Open questions

- **Per-item manual override surface.** The integration master can already
  hand-edit a single chip's tag, but should there be a *recorded* override (e.g.
  a `model/effort` column the release plan §2 can set per item that the resolver
  honours over the band default)? Deferred to the E7 implementation agent to
  decide — current recommendation: no config surface, manual chip edit suffices,
  to keep the resolver single-input.
- **Band thresholds vs. the existing two-table phrasing.** E7.2 introduces
  explicit kEst-token boundaries (15/40/80). The current `grm-release-phase` table
  uses only 15 K / 80 K (no 40 K split). The E7 agent should confirm the 40 K
  small/medium split is wanted, or collapse small+medium if it adds no value for
  the five starters (note: in Medium they resolve identically, so the split is
  only load-bearing for High/Low/Efficient/Eco).

## Follow-ups

- **E7 (implementation):** create `.claude/model-effort-profiles.json` with the
  five starters; implement the resolver; rewrite `grm-repo-reference` to point at the
  registry; add the `model-effort-profile` config field + onboarding preview
  question; wire bootstrap/golden to ship the registry.
- **E8 (implementation):** edit `grm-release-phase` Step 3/Step 5/Anti-patterns to
  resolve via E7 and render the leading `[model/effort]` tag in every spawned
  task name.
- **`grm-model-effort-profile-switch` skill:** ✅ **shipped at v1.10 (P1)** — a
  dedicated switch skill (like `grm-work-paradigm-switch`) that validates the value
  against the registry and drops `in-development`. It does **not** bump
  schema-version (the field already lives at v3; graduation is a flag-drop — see
  §5.6) and performs **no file-swap** (the resolver reads the field live). The
  skill is ergonomics + a fail-closed validation guard, layered on a resolver
  that already takes a config edit live.
- **Copilot flavor port:** mirror the registry + resolver documentation into
  `copilot/` per `CLAUDE.md` §Source of truth, after `claude-code/` canonical
  lands.
- **Custom profiles + validation:** allow user-authored profiles in the registry
  with a validation pass (band completeness, allowed model/effort enums).
- **Budget-driven auto-selection:** once E1/E2's measurement harness produces
  per-profile token/cost data, consider auto-recommending a profile from a
  declared release budget.
