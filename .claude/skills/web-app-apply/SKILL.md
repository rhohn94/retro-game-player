---
name: web-app-apply
description: Retrofit web-app support onto an already-bootstrapped Grimoire project. Re-runs the Q9 signal table read-only, confirms with the user (auto-picks under Noir), writes the web-app config block, and seeds the web-app obligations into docs/roadmap.md, the deployment-protocol pointer, and build-recipe deploy/package stubs. Idempotent; fails closed on a missing config file or a non-web repo. Use when retrofitting web-app support onto an existing project.
---

# web-app-apply

Records the **web-app fact** and seeds the web-app obligations for a Grimoire
project bootstrapped **before** v3.26 (the retrofit path; new projects use
onboarding/bootstrap detection — `web-app-support-design.md` §2).

Built on the canonical **switch-skill pattern** (fail-closed validation,
idempotent early-exit, pure-data config write, error-conditions table) with a
detection front-end bolted on.

Design authority: `docs/design/web-app-support-design.md` §3 (full skill
design), §1 (config block shape), §2 (detection contract).
Full Q9 signal table: see `reference.md` (sibling of this file).

> **Pure-data write — no file-swap.** The `web-app` block is data consumers
> read live. Writing the key into `grimoire-config.json` IS the activation.
> Schema-version is **not** bumped (§1.3 — additive, absence-as-default).

---

## §1 — Prerequisites (fail-closed validation)

Run before any detection or write. Abort on failure.

1. **Config file must exist.** Locate `.claude/grimoire-config.json` by
   walking up from the cwd. If missing → abort:
   > "Error: `.claude/grimoire-config.json` not found. Run
   > `workflow-bootstrap --restore` to restore framework files."

2. **Config must parse as valid JSON.** If invalid → abort:
   > "Error: `.claude/grimoire-config.json` is not valid JSON. Fix it before
   > running web-app-apply."

3. **Existing `web-app.value`, when present, must be `"yes"` or `"no"`.**
   Any other value → abort without writing:
   > "Error: existing `web-app.value` is '<val>' — not in {yes, no}. Fix the
   > config manually."

---

## §2 — Idempotent early-exit

Read the current `web-app` block (may be absent). If **all** of the following
hold, exit "Web-app support is already configured. No changes made." and stop:

- `web-app.value` is `"yes"`.
- `web-app.stack` matches the detected/confirmed stack (or is `null` and none
  was detected).
- All three baseline rows (`web-app-healthz`, `web-app-deploy-bundle`,
  `web-app-service-supervision`) are present in `docs/roadmap.md` matched by
  their `<!-- key: … -->` markers.

Running the skill twice on the same project is a no-op the second time.

> **Non-web early-exit.** If §3 detects no web signal and the user has not
> supplied an override, exit "No web-app signal detected; nothing to apply."
> — no writes, clean exit.

---

## §3 — Detection front-end (Q9 read-only)

Re-run the `workflow-bootstrap` Step 3 Q9 20-row signal table **read-only and
offline** against the existing repo. No network; no file writes during this
step. The full signal table is in `reference.md`.

**Web-slice rows (web-app = yes candidate):** rows 8–13/15–18 plus a
server-rendered web framework (Flask/Django/FastAPI/Express/Rails/Gin) with a
view layer (templates dir, `render_template`, `res.render`, or `views/`).

**Not-web rows:** rows 1–7 (native/mobile), 9 (`react-native`/`expo`),
14 (`electron`), 16 (TUI), 19–20 (headless/library).

Confidence levels:
- **High** — framework dep (rows 8–13/15 or server-rendered) + corroborating
  config (rows 17–18).
- **Medium** — single dep signal, no corroborating config; or lone config file.
- **Low/none** — no web signal, or ambiguous peers.

### 3.1 Surface the evidence

Report every row that fired, the derived stack hint, and the confidence level.
Example: "Detected React (web) — found `react`, `react-dom` in `package.json`
+ `vite.config.js`. Confidence: High."

### 3.2 Confirm

After surfacing evidence, **confirm before writing**:

- **Supervised / Weiss:** `AskUserQuestion` with pre-filled default (High →
  pre-select "Yes (web app)"; Medium → pre-select but phrase as question;
  Low/none → cold question). A "No" → clean exit, no writes.
- **Noir:** auto-pick the top detection result. **Must report** what was
  applied and why: "Applying web-app support: detected {stack} (High —
  {evidence}). Proceeding." A non-web repo (no web-slice signal) → clean exit
  with no writes; report reason.

**Detection never auto-commits** — a non-web repo always exits without writes.

---

## §4 — Config write (pure-data, preserve all fields)

Write **only** the `web-app` key into `.claude/grimoire-config.json`.
All other fields untouched; `schema-version` unchanged.

Block shape (`web-app-support-design.md` §1.2):

```json
"web-app": {
  "value": "yes",
  "stack": "React (web)"
}
```

`stack` is the confirmed stack string, or `null` if unknown. Write valid,
prettily-formatted JSON; preserve existing indentation (2-space convention).

A decline writes nothing (omission is the preferred idiom — §1.3); `"no"` may
be written on an explicit "remember this decline" request to suppress future
re-prompting.

---

## §5 — Obligation seeding (additive, idempotent)

Seed the web-app obligations so the retrofitted project matches a freshly-
detected one. All seeding is **extend-only** — match by stable key, add only
missing entries, never overwrite existing content.

### 5.1 Baseline-requirement rows

Source: `.claude/skills/onboarding/baseline-requirements.md` (the maintained
source list — do not hard-code row text here).

Append the three web-app rows into `docs/roadmap.md` under
`## Framework-required (baseline)`:

```
- <row text from baseline-requirements.md> [framework-required] <!-- key: web-app-healthz, shape: web app -->
- <row text from baseline-requirements.md> [framework-required] <!-- key: web-app-deploy-bundle, shape: web app -->
- <row text from baseline-requirements.md> [framework-required] <!-- key: web-app-service-supervision, shape: web app -->
```

**Idempotency:** scan for `<!-- key: <key>` before appending. If found, skip
that row. If `## Framework-required (baseline)` does not exist, create it.
If `docs/roadmap.md` does not exist, create it with the section + rows.

### 5.2 Deployment-protocol pointer

Add to the `## Framework-required (baseline)` section header (or a sibling
comment line) if not already present:

```markdown
<!-- web-app deployment protocol: docs/web-app-deployment-protocol.md -->
```

Idempotency: skip if the string `web-app deployment protocol:` is already
present anywhere in the section.

### 5.3 Build-recipe deploy/package stubs

If `recipe.py` exists, scan for `def deploy(` and `def package(`. For each
**absent** target, append a stub at the end of the file:

```python
def deploy(args):
    """deploy — web-app deployment target (docs/web-app-deployment-protocol.md §4).
    TODO: implement per the deployment protocol.
    """
    raise SystemExit(2)  # exit-2: unimplemented target


def package(args):
    """package — produce the deployable bundle (versioned archive + release.json
    + grimoire-build-info.json). See docs/web-app-deployment-protocol.md §1–§3, §8.
    TODO: implement per the deployment protocol.
    """
    raise SystemExit(2)  # exit-2: unimplemented target
```

**Extend-only:** if `deploy` or `package` already exists (implemented or
stubbed), leave it exactly as-is. The `exit-2` stub signals "unimplemented"
per the build-recipe interface contract.

If `recipe.py` does not exist, skip this sub-step — do not create the file.

---

## §6 — Catalog filing

Once the `web-app` block is written and §5 seeding is complete, file the
required-feature catalog. Catalog source:
`.claude/skills/web-app-apply/required-feature-catalog.md` (sibling of this
file, `catalog-version` on line 1).

### 6.1 Deduplicate (idempotent)

Before filing any entry, read all existing `Grimoire-Requirement`-tagged
issues (open **and** closed):

```bash
python3 .claude/skills/issue-tracker/issue_tracker.py list \
  --labels Grimoire-Requirement --state all
```

MCP equivalent: `list_issues` with `labels=["Grimoire-Requirement"]`. For
each catalog entry whose `[key: <key>]` marker appears in any existing issue
title, **skip it — do not file again**.

### 6.2 Spawn a Reporter for each unfiled entry

For each entry not already filed, spawn a **Reporter** agent (`reporter`
skill) to file one `Grimoire-Requirement`-tagged ticket via `feedback-to-issue`:

- **Title:** as specified in the catalog entry (includes `[key: <key>]`).
- **Body:** as specified in the catalog entry.
- **Labels:** `Grimoire-Requirement` (+ any entry-specific labels).
- **Audience:** `internal` (framework requirements are always internal).

`ensure_label` is called automatically by `IssueTracker.create()` (WEB-5),
so the `Grimoire-Requirement` label exists on GitHub before filing.

A re-run that finds every entry already filed exits: "Catalog already filed —
no new entries." A first run files exactly the unfiled entries.

---

## §7 — Final confirmation

```
web-app-apply complete.
  Config:    web-app.value = "yes", stack = "{stack}"
  Baseline:  web-app-healthz seeded / already present
             web-app-deploy-bundle seeded / already present
             web-app-service-supervision seeded / already present
  Protocol:  pointer recorded / already present
  Recipe:    deploy stub added / already present
             package stub added / already present
  Catalog:   N entries filed / already filed (catalog-version: 1)
```

---

## Error conditions summary

| Condition | Behaviour |
|---|---|
| `grimoire-config.json` missing | Abort; print `workflow-bootstrap --restore` instruction |
| Config not valid JSON | Abort; do not write |
| Existing `web-app.value` not in `{yes, no}` | Abort; do not write |
| No web-app signal (non-web repo) | Clean exit; no writes; report reason |
| User declines confirmation (Supervised/Weiss) | Clean exit; no writes |
| `web-app.value` already `"yes"` + same stack + obligations seeded | Early exit; "already configured" |
| `web-app.value` already `"yes"` but obligations incomplete | Skip config write; proceed to §5 seeding |
| `recipe.py` absent | Skip §5.3; not an error |
| `deploy`/`package` already in `recipe.py` | Leave unchanged; skip stub |
| `docs/roadmap.md` absent | Create with baseline section + web-app rows |

---

## Anti-patterns

- Writing the block **without** a confirm or Noir report. (`web-app-support-design.md` §3.4)
- Writing `web-app = yes` on a **non-web** repo — exit cleanly.
- **Bumping `schema-version`** — stays at current value. (§1.3)
- Touching any config field other than `web-app`.
- **Re-seeding** rows already present — dedupe by `<!-- key: … -->`.
- Implementing deployment-protocol mechanics — WEB-4's scope.
- Implementing the Admin Console inside a managed app — the catalog SPEC is the deliverable; implementation is the managed project's scope.
- **Overwriting** an existing `deploy` or `package` function in `recipe.py`.
- Hard-coding baseline row text — always read from `baseline-requirements.md`.

---

## Seams

- **WEB-2** (`config_validate.py`) registers `web-app.value ∈ {yes, no}`.
- **WEB-4** (`docs/web-app-deployment-protocol.md` + baseline-requirements
  web-app rows + `recipe.py` stubs) must be merged for full obligation seeding.
- **WEB-7** — §6 catalog filing live; catalog at `required-feature-catalog.md`.
- **WEB-9** — feature-manifest row, workflow-bootstrap manifest `Restorable
  skills` row, install-doctor wiring, copilot mirror, golden re-capture.
