# UX Design Language

> **Up:** [↑ Design docs](README.md)


## Motivation

Projects built on this scaffolding share workflow plumbing (skills, hooks,
branch model) but historically had **no shared concept of UX design language**.
Each new GUI project re-invented its visual vocabulary — colour palette,
spacing scale, control taxonomy, interaction grammar — from scratch, or
silently inherited fragments from whichever sample code happened to be at hand.

v1.3 closes that gap by introducing a workflow for adopting and adapting a
configurable upstream design language (default
`https://github.com/rhohn94/design-language`) into every GUI project, plus a
minimal `ux-demo` proving the adaptation works on the project's own stack.

The mechanism must:

- Travel **with** the scaffolding so a fresh project picks it up at day zero.
- Adapt rather than transplant: the upstream is HTML/CSS-flavoured, but
  downstream projects may be desktop, mobile, CLI, or anything else.
- Defer cleanly for projects that don't have (or don't yet have) a GUI,
  without leaving hidden state that disappears from review.
- Re-run idempotently when upstream changes, producing a reviewable diff
  rather than clobbering a project's local adaptation.

This document is the canonical reference for that workflow. Phase 2 work
items (P2.1–P2.9) implement what is specified here; Phase 3 items (P3.1, P3.2)
mirror it to the `copilot/` flavor and the root dogfood. The plan is in
[`release-planning-v1.3.md`](../../release-planning-v1.3.md).

## Scope

**In scope (designed here, implemented in Phase 2/3):**

- A per-project template stub at `docs/design/ux/design-language.md` with a
  YAML front-matter source mode (`upstream` / `local`), a recorded
  `source-sha:`, and an embedded acceptance checklist.
- A subdir convention under `docs/design/` that gives downstream projects a
  canonical UX tier without forcing the scaffolding's own meta-docs into the
  same shape.
- Two new skills: `grm-design-language-adapt` (initial / re-adaptation from
  upstream, with strict-local opt-out) and `grm-ux-demo-build` (opt-in build of a
  minimal demo in the project's own stack).
- A `git clone`-based source-pull mechanism, including landing-dir choice,
  offline-fallback semantics, retry semantics, and SHA recording — the
  ergonomics spike is **resolved inline** in §Source-pull mechanism, not
  deferred.
- Initialization integration via `grm-repo-init` (Step 6) and `grm-workflow-bootstrap`
  (interview question + manifest entries).
- A roadmap-based GUI-deferral mechanism for projects whose GUI is "not yet".
- A `ux-demo/` policy (location, scope, stack purity, refresh discipline).
- A verification model that combines an in-doc acceptance checklist with
  screenshots under `ux-demo/screenshots/`.
- Cross-flavor parity: every artefact mirrored to `copilot/` and the root
  dogfood (acknowledged here; owned by P3.1 / P3.2).

**Out of scope for v1.3** (mirrors §4 of the planning doc):

- Auto-maintaining `ux-demo/`. Once a project's demo passes user review, it is
  refreshed only by an explicit `grm-ux-demo-build` invocation.
- Designing the upstream `design-language` repo itself. v1.3 only **consumes**
  it.
- Auto-detecting GUI frameworks. Bootstrap asks; the user answers.
- A second-level component library / theme system on top of the design
  language. The adapted local [design-language.md](../../design/ux/design-language.md) is the project's authority.
- Automated visual-regression testing of `ux-demo`. Verification is
  user-review of the checklist + screenshots; automated tooling is deferred.
- Implementing the Phase 2 skills themselves. This doc specifies them; it does
  not build them.

### Release phase shape (locked decision #7 — acknowledged)

Three phases, owned by the planning doc:

- **Phase 1** — this design doc (P1.1). Blocks Phase 2.
- **Phase 2** — canonical implementation in `claude-code/` (P2.1–P2.9).
- **Phase 3** — Copilot port (P3.1) and root dogfood with history backfill
  (P3.2).

## Design

### Adaptation policy

**Verbatim where possible, adapt where necessary.** The upstream design
language is the source; the local [design-language.md](../../design/ux/design-language.md) is the **project's
authority** once adapted.

Concrete examples of the spectrum:

- A web project may reference the upstream HTML/CSS examples almost verbatim,
  with only token renames and project-specific component names.
- A desktop GUI project may **model** its controls after the upstream
  HTML/CSS examples — colour tokens, spacing scale, control affordances — but
  cannot reuse the HTML/CSS directly. The adaptation translates each upstream
  concept into the project's GUI framework.
- A CLI project takes only the conceptual primitives (information hierarchy,
  emphasis, error-vs-warning vocabulary) and adapts them to its TUI / plain
  text rendering. Most upstream surface area simply does not apply.

After adaptation, the upstream is **frozen by SHA** in the local doc's
front-matter (see §Source-pull mechanism). The adapt skill never silently
re-pulls or rewrites — diffs are surfaced for human review (see §Lifecycle).
This is how adaptation stays the project's own property rather than a
shadow-fork of upstream.

### Subdir convention

`docs/design/` may use subdirectories to organise design docs by tier.
**Downstream projects' UX-tier design docs live under
`docs/design/ux/`**, with `docs/design/ux/design-language.md` as the
canonical anchor (and additional `ux/`-tier docs like component maps or
theming notes alongside it as the project grows). The
[`grm-repo-reference`](../../../claude-code/.claude/skills/grm-repo-reference/SKILL.md)
doc-location map is updated in work item P2.6 to list `docs/design/ux/` with
the description "UX-tier design docs (design-language, components,
theming)".

The **scaffolding repo itself stays flat**. This doc lives at
`docs/design/ux-design-language-design.md`, not
`docs/design/ux/ux-design-language-design.md`, because it is **meta-workflow
design about the UX feature**, not a UX-tier design doc of a downstream
project. The `ux/` subdir is reserved for the per-project artefacts it
specifies.

The per-project stub (work item P2.1) has front-matter of the form:

```yaml
---
source: upstream                # or 'local' for strict-local mode
source-url: https://github.com/rhohn94/design-language
source-sha:                     # filled by design-language-adapt
adaptation-status: draft        # draft | ready-for-review | adopted
---
```

The stub then carries Motivation, Scope, Design (local tokens, component
map), Adaptation acceptance (checklist), Open questions, and Follow-ups,
following the house layout described in
[`docs/design/README.md`](README.md).

### Source-pull mechanism

This section **resolves locked decision #8** — the `git clone` ergonomics
spike — inline.

**Clone command.**

```bash
git clone --depth=1 https://github.com/rhohn94/design-language .design-language-source/
```

Always `--depth=1`. The skill never needs upstream history; only the current
HEAD and its SHA.

**Landing directory.** `.design-language-source/` at the **repo root**.

- Local-only, **gitignored**. Work item P2.5 (`grm-repo-init` Step 6) and P2.2
  (the `grm-design-language-adapt` skill's first run) are jointly responsible for
  appending the directory to `.gitignore` if absent. The scaffolding's own
  `.gitignore` ships with the entry pre-added.
- **Not** under `.claude/` — it is not a Claude-harness artefact, and a human
  may want to browse it.
- Single, stable path. The skill always clones to the same dir so re-runs are
  truly idempotent and the file system doesn't accumulate clones.

**Source-URL override.** The clone URL comes from `source-url:` in the
per-project stub's front-matter (default
`https://github.com/rhohn94/design-language`). Forking or pinning is a
front-matter edit — no skill code changes required.

**Sandbox & network ergonomics.** Subagents may run in network-sandboxed
sessions. The skill's first action is a network capability check
(`git ls-remote` against the configured URL with a short timeout). Three
outcomes:

1. **Network OK + clone succeeds** → proceed to adaptation. Record the new
   HEAD SHA (see below).
2. **Network OK + clone fails** (e.g., URL changed, repo deleted, auth
   failure) → fail closed with a clear message naming the URL and the git
   error. Do not proceed.
3. **Network unavailable** → check for a pre-existing
   `.design-language-source/` directory. If present, use it as-is (note in
   the report that the offline copy is being used and its SHA is whatever
   `git -C .design-language-source rev-parse HEAD` reports). If absent,
   fail closed with a clear message saying "no network and no offline
   source available; re-run the skill with network access or set
   `source: local` in the stub".

**Retry semantics.** **No automatic retry.** A failed clone reports the
failure and exits. The user re-invokes the skill if they want to try again.
Auto-retry hides intermittent network issues and risks silent inconsistency
across runs.

**SHA recording.** After a successful clone (or a successful re-use of an
offline copy), the skill records
`git -C .design-language-source rev-parse HEAD` into the per-project stub's
`source-sha:` front-matter field. This is the **single source of truth** for
"which upstream commit this project's adaptation derives from". It is never
recorded anywhere else (e.g., not in a separate lockfile) — keeping it in the
doc front-matter ties the version of the adaptation to the version of the
record, which is what humans review.

**Idempotency.** Re-running the skill compares
`.design-language-source/`'s new HEAD SHA to the `source-sha:` recorded in
the stub:

- Same SHA → no-op. Skill reports "already up to date with
  `<source-url>@<sha>`".
- Different SHA → produce a per-file diff for the user to apply selectively
  (see §Lifecycle).
- Missing `source-sha:` → treat as initial adaptation (first run or
  strict-local → upstream switch).

A re-run **never overwrites the local [design-language.md](../../design/ux/design-language.md)** without an
explicit user action. The skill's output is review material; the user
applies.

### Strict-local mode

A project that wants to maintain its design language **entirely by hand** —
no upstream pull, no SHA tracking, no expectation of diffs — sets
`source: local` in the per-project stub's front-matter.

Under `source: local`:

- `grm-design-language-adapt` **skips the clone step** entirely. No network call,
  no `.design-language-source/` directory created.
- The skill treats the project's existing [design-language.md](../../design/ux/design-language.md) content as
  **authoritative**. It does not propose changes, does not record a
  `source-sha:` (the field is left empty or omitted), and does not check
  upstream for drift.
- The skill's only useful action in strict-local mode is to (re-)generate the
  embedded acceptance checklist if the user has invalidated it, and to defer
  to `grm-ux-demo-build` for the demo refresh.
- Switching back to upstream is a front-matter edit (`source: upstream`)
  followed by a normal re-invocation; the missing `source-sha:` triggers the
  initial-adaptation path.

Strict-local is the right choice when the project's design language has
diverged far enough from upstream that diffs are noise rather than signal,
or when the project never wanted upstream coupling in the first place.

### GUI-deferral mechanism

`grm-workflow-bootstrap` (work item P2.4) gains a three-way question in its Step 3
interview:

> **Will this project have a GUI?** (Yes / Not yet / No, headless)

Routing of the three answers:

- **Yes** → ask follow-up questions (upstream URL, default
  `https://github.com/rhohn94/design-language`, or `local`; primary GUI
  framework hint for `grm-ux-demo-build`); proceed normally. `grm-repo-init` Step 6
  (work item P2.5) runs `grm-design-language-adapt` at day zero.
- **Not yet** → bootstrap appends a one-line note to
  [`docs/roadmap.md`](../../roadmap.md). The note lives **under the next
  planned version's block** (or in a `Backlog` section if no concrete next
  version exists yet), with the form:
  ```
  - UX design language: deferred until v{X.Y}.
  ```
  The deferral is visible during release planning — when the integration
  master next runs `grm-release-planning`, the roadmap entry surfaces the
  pending work for that version.
- **No, headless** → bootstrap marks the design-language slot **N/A** in the
  manifest's restorable-skills view (i.e., `grm-design-language-adapt` and
  `grm-ux-demo-build` are skipped for this project's bootstrap). The user can
  always re-run bootstrap later if the project gains a GUI.

**Crucially**, the deferral is **never a hidden marker file** (no
`.no-gui`, no `.gitignored-deferral-flag`, no marker in `.claude/`). The
roadmap is the canonical visible state. If a deferred project's roadmap
loses the entry, the deferral is forgotten by design — there is no
out-of-band reminder.

### ux-demo policy

**Location.** `ux-demo/` **at the repo root**. Not under `docs/`, not under
`.claude/`, not nested in any source tree. A peer to `src/` (or the
project's equivalent). Treat it as a small, opt-in sub-project of the host
repo.

**Scope: minimal, project-relevant.** The first version of any project's
`ux-demo` covers **only the controls and views most relevant to that
project** — not a complete implementation of the design language. Concrete
guidance:

- Include: the 2–5 controls or views the project uses most, rendered in the
  adapted design language.
- Defer: long-tail controls, edge-case states, anything the project does not
  itself use in real code.

The rule of thumb: if a reviewer can't tell from this demo whether the
adaptation is good enough for the project's actual UI, the demo is missing
something. If they could tell **just as well** from a smaller version, the
demo is too big.

**Stack purity.** The demo is built in the **project's own tech stack**.

- A desktop GUI project's demo uses the project's GUI framework — no HTML/CSS
  leak.
- A CLI project's demo uses the project's terminal-rendering stack — no React
  leak, no headless browser.
- A library project's demo (if one exists) uses the library's host stack.

The `grm-ux-demo-build` skill (work item P2.3) enforces this in its acceptance
checklist.

**Not auto-maintained.** Once the demo passes user review, it is **frozen**
until the user explicitly re-invokes `grm-ux-demo-build`. The demo does not run
in CI, is not regenerated on every adapt-skill run, and does not block
releases. This is a deliberate trade — the demo is a one-shot artefact
proving "the adaptation works for this project's needs", not a live UI
fixture.

**Opt-in refresh.** `grm-ux-demo-build` is the **only** path that touches
`ux-demo/`. `grm-design-language-adapt` can suggest "the demo may need a
refresh" in its report after a successful upstream pull, but never runs
`grm-ux-demo-build` itself (per P2.2 acceptance: "Skill kicks off `grm-ux-demo-build`
only with explicit user consent").

### Verification model

The adaptation's correctness is verified by **two artefacts the user
reviews**:

1. **An embedded acceptance checklist** in the per-project
   [design-language.md](../../design/ux/design-language.md). Each item is of the form "the demo correctly shows
   X" — e.g. "the primary button uses the adapted accent colour"; "the
   error state uses the adapted error palette and warning iconography"; "the
   form-field stack uses the adapted spacing scale". The checklist is the
   project-specific contract: when every box is ticked, the adaptation is
   considered ready.
2. **Screenshots** of `ux-demo/`'s controls and views, committed under
   `ux-demo/screenshots/`. Filenames map 1:1 to checklist items where
   practical (e.g., `primary-button.png`, `error-state.png`). Screenshots
   are the evidence; the checklist is the assertion.

The user marks checklist items complete by editing
[design-language.md](../../design/ux/design-language.md). **The `grm-ux-demo-build` skill never auto-marks them.**
At most, the skill updates `adaptation-status:` from `draft` to
`ready-for-review` when the demo builds clean — but never to `adopted`.

This verification model is **provisional**. It may iterate post-v1.3 (for
example, by introducing automated visual checks of the screenshots), but
v1.3 ships the human-review version.

### Lifecycle

The adapt skill is designed to be re-run safely, possibly years after the
initial adaptation, against a moved-on upstream. The lifecycle:

1. **Initial adaptation** (first run, or first run after a strict-local →
   upstream switch).
   - No `source-sha:` recorded in the stub yet.
   - Skill clones upstream into `.design-language-source/`, reads it,
     produces a draft local adaptation, and records the upstream HEAD SHA.
   - User reviews and finalises the draft; `adaptation-status:` advances to
     `adopted` when the user is happy.

2. **Re-adaptation after upstream changes** (subsequent runs).
   - Skill clones upstream into the same `.design-language-source/` dir.
   - Skill compares new HEAD SHA to `source-sha:` in the stub.
   - **Same SHA** → no-op; skill reports "already up to date".
   - **Different SHA** → skill produces a **per-file diff** of upstream
     changes since `source-sha:` (`git -C .design-language-source diff
     <source-sha>..HEAD`) and presents it to the user for **selective
     application**. The local [design-language.md](../../design/ux/design-language.md) is **not** rewritten;
     the user picks which upstream changes are worth reflecting in the
     adaptation.
   - After the user applies what they want, the skill updates `source-sha:`
     to the new HEAD.
   - If the user wants to skip a particular upstream change, they apply
     nothing and still bump `source-sha:` — the next run then diffs only
     against the newer baseline. This avoids re-presenting changes the
     user has consciously declined.

3. **Strict-local → upstream switch.** Treated as initial adaptation: no
   `source-sha:` is recorded, so the skill takes the first-run path.

4. **Upstream → strict-local switch.** Trivial: edit the front-matter to
   `source: local`. The recorded `source-sha:` becomes a historical
   curiosity; the skill ignores it.

**Idempotency guarantees.** Re-running the skill with no upstream change
produces no file edits. Re-running it with an upstream change always
produces review material, never a silent overwrite.

### Initialization integration

The day-zero and bootstrap integration points are owned by separate Phase 2
work items but share this spec.

- **`grm-workflow-bootstrap` (work item P2.4).** Adds the GUI question (see
  §GUI-deferral mechanism) to its Step 3 interview. Captures the upstream
  URL (or `local`) and a GUI framework hint when the answer is **Yes**.
  Lists `grm-design-language-adapt` and `grm-ux-demo-build` in the manifest's
  Restorable-skills table so subsequent restores cover them. Introduces new
  project-config tokens (e.g. `{design-language-source-url}`,
  `{ux-demo-stack}`) for any placeholder substitution downstream.
- **`grm-repo-init` (work item P2.5).** Inserts a new **Step 6 — "UX design
  language (optional)"** describing the day-zero invocation of
  `grm-design-language-adapt` for **Yes**-answer GUI projects, with the
  roadmap-deferral path as the alternative for **Not yet** and the skip path
  for **No, headless**. Anti-patterns gain an entry: "Skipping UX design
  language for a GUI project without recording deferral in [roadmap.md](../../roadmap.md)".
- **`docs/grimoire/integration-workflow.md` (work item P2.8).** Adds a §UX design
  language anchor placed as a **project-init concern**, not a per-release
  concern. Lists the two trigger moments for `grm-design-language-adapt`
  (initial adaptation at day zero, on-demand re-adaptation later) and the
  one trigger moment for `grm-ux-demo-build` (opt-in, user-initiated).
- **`claude-code/CLAUDE.md` (work item P2.9).** Adds a short
  (~5-line) paragraph noting that GUI projects own a
  `docs/design/ux/design-language.md` plus a `ux-demo/` at the repo root,
  while non-GUI projects defer via a `docs/roadmap.md` note. Links the two
  new skills.

### Cross-flavor parity

Every artefact specified above ships in **all three flavors** of the
scaffolding:

- **`claude-code/`** — canonical implementation. Phase 2 owns this.
- **`copilot/`** — Copilot port. Skills become
  `.github/prompts/{name}.prompt.md` (with Copilot front-matter:
  `mode: agent`, `description: …`). Docs ([integration-workflow.md](../integration-workflow.md),
  `AGENTS.md`, the per-project stub) are mirrored verbatim where the content
  is flavor-agnostic. Owned by work item P3.1.
- **Root dogfood** — this repo's own working copy. Mirrors the canonical
  `claude-code/` state into root `.claude/skills/`, root `docs/design/`, and
  root `CLAUDE.md`. Owned by work item P3.2.

The design doc only **acknowledges** parity; the parity work is performed by
P3.1 and P3.2. If a future change to this design lands in canonical only,
treat the gap as a bug — every artefact has three homes.

## Acceptance

This design doc is accepted when **all** of the following hold:

- [ ] The doc exists at the flat path `docs/design/ux-design-language-design.md`
      and follows the [house layout](README.md#house-layout) (Motivation,
      Scope, Design, Acceptance, Open questions, Follow-ups).
- [ ] All eight locked decisions from
      [`release-planning-v1.3.md`](../../release-planning-v1.3.md) §5 appear
      either verbatim or as named section anchors:
      1. Subdir convention → §Subdir convention.
      2. Strict-local opt-out via YAML front-matter → §Strict-local mode.
      3. Upstream-pull via `git clone --depth=1` of
         `https://github.com/rhohn94/design-language` into a gitignored
         `.design-language-source/` → §Source-pull mechanism.
      4. GUI-deferral via `docs/roadmap.md` (not a hidden marker) →
         §GUI-deferral mechanism.
      5. `ux-demo/` at repo root → §ux-demo policy.
      6. Verification = embedded checklist + `ux-demo/screenshots/`
         (provisional) → §Verification model.
      7. Three-phase release shape (P1 design, P2 canonical, P3 Copilot +
         dogfood) → §Scope / Release phase shape.
      8. `git clone` ergonomics spike resolved inline →
         §Source-pull mechanism (landing dir, offline-fallback, retry, SHA
         recording all specified, not deferred).
- [ ] [`docs/design/README.md`](README.md) is updated to index this doc.
- [ ] Phase 2 work items can cross-link to specific section anchors —
      §Source-pull mechanism, §Lifecycle, §Subdir convention,
      §Strict-local mode, §GUI-deferral mechanism, §ux-demo policy,
      §Verification model, §Initialization integration,
      §Cross-flavor parity — without needing to introduce new anchors.

## Open questions

- **Exact placement of the GUI-deferral note in `docs/roadmap.md`.** This doc
  specifies "under the next planned version's block, or in a `Backlog`
  section if no concrete next version exists yet". P2.4 (workflow-bootstrap
  update) must commit to **one** concrete shape at implementation time —
  either always under the next version block (creating one if absent), or
  always in a dedicated `Backlog` section. The choice affects how
  `grm-release-planning` discovers the deferral.

## Follow-ups

- **Auto-detecting GUI framework hints.** Currently the user answers; a
  heuristic detector (e.g., from `package.json`, `Cargo.toml`, project file
  globs) could pre-fill the hint. Deferred to v1.4+ if it proves useful.
- **Component library or theme system on top of [design-language.md](../../design/ux/design-language.md).** The
  adapted doc is currently the project's authority; a richer typed-token /
  component-library layer is deferred to v1.4+.
- **Automated visual-regression testing of `ux-demo/`.** The current
  verification model is human-review of checklist + screenshots. Automated
  visual diffs against a baseline could replace or augment human review;
  deferred indefinitely (out of scope for v1.3, not promised for v1.4).
- **Pinning to a specific upstream SHA via front-matter.** *(Addressed in
  v1.4 C1.)* `source-pin:` is now a supported front-matter field in the
  stub and honoured by `grm-design-language-adapt` (checks out that SHA
  instead of HEAD; recorded distinctly in `source-sha:`).
- **Source URL allowlist / verification.** *(Addressed in v1.4 C1.)* The
  skill now verifies `source-url:` against a documented default allowlist
  (`github.com/rhohn94`) and warns — with an explicit confirmation prompt —
  before cloning from any off-allowlist host.
