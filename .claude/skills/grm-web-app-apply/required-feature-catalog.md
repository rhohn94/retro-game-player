catalog-version: 3

# Required-feature catalog (Grimoire web-app)

This is the maintained, versioned catalog of **framework-mandated features**
that every Grimoire web app must have. It is the web-app analogue of
`onboarding/baseline-requirements.md`, scoped to the web-app fact
(`web-app.value: yes`).

Design authority: `docs/design/web-app-support-design.md` §5 (catalog format
§5.1, filing flow §5.2, first entry §5.3).

The catalog is read by the **filing flow** (§5.2): when `web-app.value` is set
(onboarding §6.5 or `grm-web-app-apply` §6), a Reporter files one
`Grimoire-Requirement`-tagged ticket per entry, deduplicated by `key`.

**Implementing** any catalog feature in a managed app is out of scope for the
catalog SPEC — it is planned and built by the managed project.

---

## Versioning

The `catalog-version: N` line on line 1 is the idempotency contract. Bump it
whenever an entry is **added** or its definition changes, so a later filing run
deduplicates correctly by checking the `key` against existing tagged issues.
Keys are **never reused or renamed** — retiring an entry is a migration (re-key
references first, then drop).

---

## Filing contract

Each entry is filed as one `Grimoire-Requirement`-tagged issue via
`grm-feedback-to-issue`. Before filing, search existing open **and closed** issues
tagged `Grimoire-Requirement` for the entry's `key` (carried in the issue title
as `[key: <key>]`). If a matching issue exists (any state), skip the entry.

Dedupe query (CLI fallback):

```bash
python3 .claude/skills/grm-issue-tracker/issue_tracker.py list \
  --labels Grimoire-Requirement --state all
```

MCP equivalent: `list_issues` with `labels=["Grimoire-Requirement"]`.

---

## Conditional applicability (`applies-when`)

Most entries are **unconditional** — every Grimoire web app MUST have them, so
they carry no predicate and are always filed (modulo the dedupe above). Some
features, however, are only relevant to a **subset** of web apps. Such an entry
carries an optional **`applies-when:`** predicate; the filing flow evaluates it
against the managed app's live `.claude/grimoire-config.json` and **files the
entry only when the predicate holds**. An app the predicate excludes never
receives the ticket — the catalog does not spam apps with a requirement they do
not need.

**Predicate grammar (minimal, v1).** A single equality over a dotted config
path:

```
applies-when: <dot.path> == "<value>"
```

- `<dot.path>` is a dotted key into `grimoire-config.json` (e.g.
  `web-app.agentic`). The resolver reads the `value`-dial form transparently
  (`web-app.agentic` resolves `{"agentic": {"value": "yes"}}` **or** the flat
  `{"agentic": "yes"}` — the same `dialval` lookup `config_validate.py` uses).
- **Absence-as-default.** If the path is absent, the predicate is **false**
  (the entry does not apply). A conditional feature is opt-in: an app must
  positively declare the capability for the entry to file.
- An entry with **no** `applies-when:` line is unconditional (the status quo for
  Entries 1–2).

The single-equality grammar is deliberately minimal. A richer predicate language
(boolean combinators, comparisons) is a future extension and is **not** required
for the current entries — see `web-app-support-design.md` §5.1.

---

## Entries

### Entry 1 — Admin Console

```
key:  admin-console
name: Administrator Console
tag:  Grimoire-Requirement
```

**Spec.** Every Grimoire web app MUST provide an **Administrator Console** —
a single, unified administrative surface accessible to the
**Application Administrator** role. The console is always reachable at the
path `/admin-console`, with **no GUI navigation button required** — a direct
URL is always sufficient.

The console is not a user-facing feature; it is a framework-required operational
surface. Its absence must be treated as a missing baseline requirement.

#### Sub-requirements (each is independently testable)

| ID | Requirement | Testable criterion |
|----|-------------|-------------------|
| AC-1 | **Single role: Application Administrator.** The console is gated to this role only; no other role can access it. | A request without the Administrator credential receives a 401/403 response at `/admin-console`. |
| AC-2 | **All server telemetry visible.** The console shows all server-side telemetry: CPU, memory, request rates, error rates, uptime — whatever the runtime exposes — updated live or on demand. | A GET to `/admin-console` returns a page containing at least one server telemetry value (e.g. uptime or memory). |
| AC-3 | **Application configuration shown and editable.** The console displays the current application configuration and allows the Administrator to edit and persist changes. | Submitting a config change via the console updates the running config; the change is visible on reload. |
| AC-4 | **View, filter, and search all application logs.** The console provides a log viewer covering all application-level logs, with filter and search capabilities. | A search query in the log viewer returns matching log lines. |
| AC-5 | **Invoke-update control.** The console provides an explicit "check for / apply update" button that triggers the deployment-protocol self-update flow (`web-app-deployment-protocol.md` §6). | Clicking the invoke-update control initiates the self-update sequence (or reports "already up to date"). |
| AC-6 | **Server/admin-level config adjustment.** The console allows editing of administrator-level config: (a) resource limits, (b) dependent-service addresses, (c) dependent-service auto-start toggles. | Each of the three sub-config items is editable and persists across a restart. |
| AC-7 | **Restart-the-web-app button.** The console provides an explicit restart control that triggers a supervised restart of the web app process (via the service supervision verb set, `web-app-deployment-protocol.md` §4). | Clicking restart causes the app process to stop and restart; the `/healthz` endpoint becomes healthy again after restart. |
| AC-8 | **Grimoire section — framework version.** The console includes a dedicated Grimoire section showing the Grimoire framework version that built the running app, sourced from `grimoire-build-info.json` (`web-app-deployment-protocol.md` §8) field `framework-version`. | The Grimoire section displays a non-empty `framework-version` string matching the value in the live `grimoire-build-info.json`. |
| AC-9 | **Grimoire section — build-time config snapshot.** The Grimoire section additionally shows the full build-time Grimoire config snapshot, sourced from `grimoire-build-info.json` field `grimoire-config`. This is a snapshot frozen at build time and may differ from the current repo config. | The Grimoire section displays the `grimoire-config` object (or a human-readable rendering of it) from the live `grimoire-build-info.json`. |
| AC-10 | **Always reachable at `/admin-console`.** The console is always reachable by navigating directly to `/admin-console`, regardless of whether any GUI navigation button links to it. Buttons are optional; the path is not. | A direct GET to `/admin-console` (with valid Administrator credentials) returns HTTP 200 and the console UI. |

**Dedupe key in filed issue title:** `[key: admin-console]`

**Issue title (when filing):**
`[key: admin-console] Implement the Administrator Console (AC-1 through AC-10)`

**Issue body template:**

```markdown
**What:** Every Grimoire web app must implement an Administrator Console
reachable at `/admin-console` (no GUI button required). This issue tracks
the full spec for the console, sub-requirements AC-1 through AC-10.

**Sub-requirements:**
- AC-1: Single Application Administrator role (401/403 for others)
- AC-2: All server telemetry visible
- AC-3: Application config shown and editable
- AC-4: View/filter/search all application logs
- AC-5: Invoke-update control (triggers §6 self-update)
- AC-6: Server/admin-level config (resource limits, dependent-service
  addresses, dependent-service auto-start)
- AC-7: Restart-the-web-app button (triggers §4 supervisor restart)
- AC-8: Grimoire section — framework version (from grimoire-build-info.json)
- AC-9: Grimoire section — build-time config snapshot (from grimoire-build-info.json)
- AC-10: Always reachable at /admin-console (direct URL, no button required)

**Expected:** All AC-1 through AC-10 sub-requirements implemented and
independently testable per the testable criteria above.

**Context / source:** Grimoire required-feature catalog (catalog-version: 3);
authority: docs/design/web-app-support-design.md §5.3;
build-info contract: docs/web-app-deployment-protocol.md §8.
```

**Labels:** `Grimoire-Requirement`, `enhancement`
**Audience:** `internal`

---

### Entry 2 — Changelog Surface

```
key:  changelog-surface
name: Changelog Surface
tag:  Grimoire-Requirement
```

**Spec.** Every Grimoire web app MUST surface its **changelog / release notes**
through the GUI. The changelog is exposed to **operators always** and to
**end users only when explicitly enabled** by a config toggle:

- **Operator-facing (always).** The Administrator Console (Entry 1) gains a
  **Changelog** section showing the application's release notes for at least the
  currently-serving version, sourced from the build-info `changelog` field
  (`web-app-deployment-protocol.md` §8). It is gated to the Application
  Administrator role like the rest of the console.
- **User-facing (toggle).** When the `changelog.user-facing` config dial is
  `on`, the app additionally exposes a public changelog surface reachable at the
  stable path **`/changelog`** for end users — no GUI navigation button required
  (the AC-10 always-reachable pattern). The dial defaults to `off`
  (absence-as-default); when `off`, `/changelog` is not exposed and only the
  operator surface exists.

The changelog is a **build-time snapshot** that travels with the bundled
version (the same rule as the build-info config snapshot), so a running or
rolled-back deployment always shows the notes of the version actually serving.

Design authority: `docs/design/changelog-surface-design.md`; build-info contract:
`docs/web-app-deployment-protocol.md` §8; config dial: `changelog.user-facing`.

#### Sub-requirements (each is independently testable)

| ID | Requirement | Testable criterion |
|----|-------------|-------------------|
| CL-1 | **Operator-facing changelog in the Admin Console (always).** | The Admin Console renders a Changelog section showing at least the currently-serving version's notes. |
| CL-2 | **Sourced from build-info.** The changelog data comes from `grimoire-build-info.json` field `changelog`, not a live remote fetch. | With `changelog` present in the live build-info the rendered notes match it; with it absent an honest empty-state shows (no error). |
| CL-3 | **`changelog.user-facing` dial gates a user surface.** When `on`, `/changelog` is reachable by an end user. | With the dial `on`, a GET to `/changelog` returns HTTP 200 and the changelog UI. |
| CL-4 | **Default off.** With the dial absent/`off`, no user-facing surface is exposed. | With the dial `off`, a GET to `/changelog` returns 404/forbidden; the operator surface still renders. |
| CL-5 | **Stable path, no button required.** When enabled, `/changelog` is always reachable directly regardless of any nav button. | A direct GET to `/changelog` (dial `on`) returns the surface without a discoverable link. |
| CL-6 | **Per-release rendering.** Each release entry shows its version and notes (date when available). | The rendered surface lists at least one release with a version identifier and its notes. |

**Dedupe key in filed issue title:** `[key: changelog-surface]`

**Issue title (when filing):**
`[key: changelog-surface] Implement the Changelog Surface (CL-1 through CL-6)`

**Issue body template:**

```markdown
**What:** Every Grimoire web app must surface its changelog through the GUI —
operator-facing always (Admin Console Changelog section), and user-facing at
`/changelog` when the `changelog.user-facing` config dial is `on` (default off).

**Sub-requirements:**
- CL-1: Operator-facing changelog in the Admin Console (always)
- CL-2: Sourced from grimoire-build-info.json `changelog` field (not live fetch)
- CL-3: `changelog.user-facing` dial gates a user surface at `/changelog`
- CL-4: Default off (no user surface unless enabled)
- CL-5: Stable path `/changelog`, no nav button required
- CL-6: Per-release rendering (version + notes)

**Expected:** All CL-1 through CL-6 implemented and independently testable per
the testable criteria above.

**Context / source:** Grimoire required-feature catalog (catalog-version: 3);
authority: docs/design/changelog-surface-design.md;
build-info contract: docs/web-app-deployment-protocol.md §8.
```

**Labels:** `Grimoire-Requirement`, `enhancement`
**Audience:** `internal`

---

### Entry 3 — Token-Bookkeeper Standard Package (conditional)

```
key:          adopt-token-bookkeeper
name:         Token-Bookkeeper Standard Package
tag:          Grimoire-Requirement
applies-when: web-app.agentic == "yes"
```

**Spec.** A Grimoire web app that **runs its own agentic / LLM workloads** —
and therefore has token cost and throughput worth surfacing — MUST consume the
**`token-bookkeeper` standard package** through the **Dependency Channel**
rather than carry an in-tree equivalent. token-bookkeeper is the framework's
**standard package** for agentic token/cost/throughput bookkeeping: a
framework-blessed reusable library published as a `vendored-crate` artifact on
its release channel (`dependency-channel-design.md` §2), vendored and pinned
exactly like any other channel dependency.

This entry is **conditional** (`applies-when: web-app.agentic == "yes"`). An app
that does **not** declare `web-app.agentic: "yes"` — a static or
non-agentic web app — is not surfaced this requirement at all (absence-as-default
`no`; see *Conditional applicability* above). The capability dial
`web-app.agentic` is additive and absence-as-default (`web-app-support-design.md`
§1.3, §5.5); an app opts in by setting it when it begins surfacing its own
agentic cost.

As with Entries 1–2 the catalog is the **SPEC**: *implementing* the adoption
(vendoring the crate, retiring the in-tree fork, building against it) is the
managed project's scope, tracked by the filed `[key: adopt-token-bookkeeper]`
ticket. The vendoring follows the standard structure — vendored deps live under
`lib/third-party/<dep>/`, never a top-level `vendor/` (CLAUDE.md §Standard
project structure).

Design authority: `docs/design/web-app-support-design.md` §5.5 (standard-package
concept + applicability); Dependency Channel artifact contract:
`docs/grimoire/design/dependency-channel-design.md` §2; vendoring + conformance:
`grm-sync-deps` / `recipe.py vendor-check`.

#### Sub-requirements (each is independently testable)

| ID | Requirement | Testable criterion |
|----|-------------|-------------------|
| TB-1 | **Vendored via the Dependency Channel.** token-bookkeeper is declared in `vendor.toml` (with `channel`/`version`) and resolved in `vendor.lock`, its bytes committed under `lib/third-party/token-bookkeeper/`. | `vendor.toml` has a `[deps.token-bookkeeper]` entry, `vendor.lock` has a matching `tree_sha256`, and `lib/third-party/token-bookkeeper/` exists with the vendored bytes. |
| TB-2 | **No in-tree equivalent.** Any pre-existing in-tree telemetry-rollup / token-bookkeeping fork is retired in favour of the vendored crate. | No first-party module under `src/` duplicates token-bookkeeper's rollup logic; the app imports the vendored crate. |
| TB-3 | **Builds and tests against the vendored crate.** The app consumes the vendored copy, not a local re-implementation. | `recipe.py build` and `recipe.py test` pass with the in-tree fork removed and the vendored crate in place. |
| TB-4 | **Channel-conformant.** The pinned release is published on its channel and the vendored bytes match the lock. | `recipe.py vendor-check` (`dependency_channel_conformance.py`) reports no violation for `token-bookkeeper`. |

**Dedupe key in filed issue title:** `[key: adopt-token-bookkeeper]`

**Issue title (when filing):**
`[key: adopt-token-bookkeeper] Adopt the token-bookkeeper standard package (TB-1 through TB-4)`

**Issue body template:**

```markdown
**What:** This web app runs its own agentic/LLM workloads, so it must surface
its token cost/throughput via the **token-bookkeeper standard package**,
consumed through the Dependency Channel (vendor the published `vendored-crate`)
rather than an in-tree fork.

**Sub-requirements:**
- TB-1: Vendored via the Dependency Channel — `[deps.token-bookkeeper]` in
  vendor.toml, resolved in vendor.lock, bytes under
  `lib/third-party/token-bookkeeper/`
- TB-2: No in-tree telemetry-rollup / token-bookkeeping fork remains
- TB-3: `recipe.py build` + `recipe.py test` pass against the vendored crate
- TB-4: `recipe.py vendor-check` reports no violation for token-bookkeeper

**Expected:** All TB-1 through TB-4 implemented and independently testable per
the testable criteria above.

**Applicability:** Filed because `web-app.agentic == "yes"`. If this app does
not in fact surface its own agentic cost, close this ticket as not-applicable
and unset `web-app.agentic`.

**Context / source:** Grimoire required-feature catalog (catalog-version: 3);
authority: docs/design/web-app-support-design.md §5.5;
Dependency Channel: docs/grimoire/design/dependency-channel-design.md §2.
```

**Labels:** `Grimoire-Requirement`, `enhancement`
**Audience:** `internal`
